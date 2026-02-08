/**
 * The Janitor — OpenCode plugin entry point.
 *
 * Wires commit detection → review orchestration → result delivery.
 */

import type { Plugin } from '@opencode-ai/plugin';
import { loadConfig } from './config/loader';
import { CommitDetector } from './git/commit-detector';
import { getCommitContext } from './git/commit-resolver';
import { resolveGitDir } from './git/repo-locator';
import { createJanitorAgent } from './review/janitor-agent';
import { NoSessionError, ReviewOrchestrator } from './review/orchestrator';
import { buildReviewPrompt } from './review/prompt-builder';
import { spawnJanitorReview } from './review/runner';
import { CommitStore } from './state/store';
import { log } from './utils/logger';

const TheJanitor: Plugin = async (ctx) => {
  const config = loadConfig(ctx.directory);
  if (!config.enabled) {
    log('disabled by config');
    return { name: 'the-janitor' } as any;
  }

  // Bridge ctx.$ to the exec(cmd) => string interface our modules expect.
  // Uses { raw } to prevent Bun's shell from escaping the command as a
  // single token — without this, "git log -1" would be treated as one
  // executable name instead of "git" with arguments "log" and "-1".
  const exec = async (cmd: string): Promise<string> => {
    const result = await ctx.$`${{ raw: cmd }}`.quiet().nothrow().text();
    return result;
  };

  const gitDir = await resolveGitDir(ctx.directory, exec);
  const agent = createJanitorAgent(config);
  const store = new CommitStore(ctx.directory);

  // Seed detector with previously processed SHAs
  const previouslyProcessed = store.getProcessed();

  // Track current root session for result delivery
  let currentSessionId: string | undefined;

  // Orchestrator handles queuing and review lifecycle
  const orchestrator = new ReviewOrchestrator(config, async (sha) => {
    const commit = await getCommitContext(sha, config, exec);
    const prompt = buildReviewPrompt(commit, {
      categories: Object.entries(config.categories)
        .filter(([, v]) => v)
        .map(([k]) => k),
      maxFindings: config.model.maxFindings,
      scopeInclude: config.scope.include,
      scopeExclude: config.scope.exclude,
    });

    if (!currentSessionId) {
      throw new NoSessionError();
    }

    const sessionId = await spawnJanitorReview(ctx, {
      parentSessionId: currentSessionId,
      prompt,
      config,
    });
    return sessionId;
  });

  // Persist SHA only after review completes successfully
  orchestrator.onCompleted((sha) => {
    store.add(sha);
    log(`persisted reviewed commit: ${sha}`);
  });

  // Commit detector
  const detector = new CommitDetector(
    async () => {
      const result = await ctx.$`git -C ${ctx.directory} rev-parse HEAD`
        .quiet()
        .nothrow()
        .text();
      return result.trim();
    },
    async (sha, signal) => {
      log(`new commit detected: ${sha} via ${signal.source}`);
      orchestrator.enqueue(sha);
    },
    config.autoReview.debounceMs,
    config.autoReview.pollFallbackSec,
  );

  // Pre-seed processed SHAs so restarts don't re-review old commits
  for (const sha of previouslyProcessed) {
    detector.markProcessed(sha);
  }

  if (config.autoReview.onCommit) {
    await detector.start(gitDir);
  }

  return {
    name: 'the-janitor',

    agent: { janitor: agent },

    // Accelerator: detect git commit via tool hook.
    // Gated on autoReview.onCommit — the accelerator is just a faster
    // path into the same detection pipeline, so it must respect the toggle.
    'tool.execute.after': async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: any },
    ) => {
      if (!config.autoReview.onCommit) return;
      if (input.tool !== 'Bash' && input.tool !== 'bash') return;

      // The command is in the output title for Bash tool calls
      const text = output.title || output.output || '';
      if (/git\s+commit/.test(text)) {
        detector.accelerate();
      }
    },

    // Session tracking + review completion detection
    event: async (input: {
      event: {
        type: string;
        properties?: Record<string, any>;
      };
    }) => {
      const { event } = input;

      // Track current root session
      if (event.type === 'session.created') {
        const info = event.properties?.info;
        if (info?.id && !info?.parentID) {
          currentSessionId = info.id;
          log(`tracking root session: ${info.id}`);
          orchestrator.sessionAvailable();
        }
      }

      // Detect review session completion
      if (event.type === 'session.status') {
        const props = event.properties;
        if (props?.status?.type === 'idle' && props?.sessionID) {
          await orchestrator.handleCompletion(props.sessionID, ctx, config);
        }
      }
    },
  } as any;
};

export default TheJanitor;
