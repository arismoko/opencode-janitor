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
import { ReviewOrchestrator } from './review/orchestrator';
import { buildReviewPrompt } from './review/prompt-builder';
import { spawnJanitorReview } from './review/runner';
import { CommitStore } from './state/store';
import { log, warn } from './utils/logger';

/** Best-effort toast — swallows errors so it never breaks init. */
function toast(ctx: Parameters<Plugin>[0], message: string) {
  try {
    (ctx.client as any).tui?.showToast?.({ message }).catch(() => {});
  } catch {
    // TUI may not be available
  }
}

const TheJanitor: Plugin = async (ctx) => {
  const config = loadConfig(ctx.directory);
  if (!config.enabled) {
    log('disabled by config');
    toast(ctx, 'Janitor: disabled by config');
    return { name: 'the-janitor' } as any;
  }

  // Bridge ctx.$ to the exec(cmd) => string interface our modules expect.
  // Uses { raw } to prevent Bun's shell from escaping the command as a
  // single token — without this, "git log -1" would be treated as one
  // executable name instead of "git" with arguments "log" and "-1".
  //
  // No .nothrow() — git failures must propagate so callers' try/catch
  // blocks can take their intended error paths (e.g. repo-locator fallback).
  const exec = async (cmd: string): Promise<string> => {
    // Pin all git commands to the workspace directory so they don't
    // depend on process cwd, which may differ from the project root.
    // Shell-quote the directory so paths with spaces/metacharacters
    // are passed as a single argument to git -C.
    const quoted = `'${ctx.directory.replace(/'/g, "'\\''")}'`;
    const pinned = cmd.startsWith('git ')
      ? `git -C ${quoted} ${cmd.slice(4)}`
      : cmd;
    const result = await ctx.$`${{ raw: pinned }}`.quiet().text();
    return result;
  };

  let gitDir: string;
  try {
    gitDir = await resolveGitDir(ctx.directory, exec);
  } catch {
    warn(`no git repo at ${ctx.directory} — janitor inactive`);
    toast(ctx, `Janitor: no git repo found — inactive`);
    return { name: 'the-janitor' } as any;
  }

  const agent = createJanitorAgent(config);
  const store = new CommitStore(ctx.directory);

  // Seed detector with previously processed SHAs
  const previouslyProcessed = store.getProcessed();

  // Orchestrator handles queuing and review lifecycle
  const orchestrator = new ReviewOrchestrator(
    config,
    async (sha, parentSessionId) => {
      const commit = await getCommitContext(sha, config, exec);

      // Hollow review guard: reject commits with no meaningful diff content.
      // This prevents wasted review cycles and misleading "all clean" results
      // when git commands failed silently or the commit is truly empty.
      if (!commit.patch.trim() && commit.changedFiles.length === 0) {
        throw new Error(
          `Empty commit context for ${sha.slice(0, 8)} — no patch or changed files`,
        );
      }

      const prompt = buildReviewPrompt(commit, {
        categories: Object.entries(config.categories)
          .filter(([, v]) => v)
          .map(([k]) => k),
        maxFindings: config.model.maxFindings,
        scopeInclude: config.scope.include,
        scopeExclude: config.scope.exclude,
      });

      const sessionId = await spawnJanitorReview(ctx, {
        parentSessionId,
        prompt,
        config,
      });
      return sessionId;
    },
  );

  // Persist SHA only after review completes successfully
  orchestrator.onCompleted((sha) => {
    store.add(sha);
    log(`persisted reviewed commit: ${sha}`);
  });

  // Give orchestrator access to the SDK client for error injection
  orchestrator.setContext(ctx);

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

  toast(ctx, 'Janitor: watching for commits');
  log(`initialized — watching ${gitDir}`);

  return {
    name: 'the-janitor',

    cleanup: () => {
      detector.stop();
      log('plugin cleanup: detector stopped');
    },

    agent: { janitor: agent },

    // Accelerator: detect git commit via tool hook.
    // Gated on autoReview.onCommit — the accelerator is just a faster
    // path into the same detection pipeline, so it must respect the toggle.
    'tool.execute.after': async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown },
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
          log(`tracking root session: ${info.id}`);
          orchestrator.sessionAvailable(info.id);
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
