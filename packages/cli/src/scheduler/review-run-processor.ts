import type { Database } from 'bun:sqlite';
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { AgentName } from '@opencode-janitor/shared';
import type { CliConfig } from '../config/schema';
import { appendEvent } from '../db/queries/event-queries';
import type { QueuedReviewRunRow } from '../db/queries/review-run-queries';
import { markReviewRunRunning } from '../db/queries/review-run-queries';
import { buildTriggerContextFromPayload } from '../reviews/context';
import {
  abortSession,
  createReviewSession,
  fetchAssistantOutput,
  parseModelOverride,
  promptReviewAsync,
} from '../reviews/runner';
import type { AgentRuntimeRegistry } from '../runtime/agent-runtime-registry';
import type {
  AgentRuntimeSpec,
  PersistableFindingRow,
} from '../runtime/agent-runtime-spec';
import type { SessionCompletionBus } from '../runtime/session-completion-bus';
import {
  type PrReviewCommentResult,
  postPrReviewComment,
} from './pr-review-comment';
import { classifyCompletionFailure } from './retry-policy';
import {
  buildFindingsFromParsedOutput,
  type ReviewRunPersistenceService,
  type SessionResult,
} from './review-run-persistence';

export interface ActiveSession {
  sessionId: string;
  directory: string;
}

interface PreparedRun {
  spec: AgentRuntimeSpec;
  prompt: string;
  modelOverride: ReturnType<typeof parseModelOverride>;
  runtimeRun: {
    id: string;
    repo_id: string;
    trigger_event_id: string;
    trigger_id: 'commit' | 'pr' | 'manual';
    scope: 'commit-diff' | 'workspace-diff' | 'repo' | 'pr';
    path: string;
    default_branch: string;
  };
}

interface ProcessorRunnerDeps {
  abortSession: typeof abortSession;
  createReviewSession: typeof createReviewSession;
  fetchAssistantOutput: typeof fetchAssistantOutput;
  promptReviewAsync: typeof promptReviewAsync;
}

type PrReviewCommentPublisher = (
  run: Pick<QueuedReviewRunRow, 'id' | 'agent' | 'path' | 'payload_json'>,
  findings: PersistableFindingRow[],
) => Promise<PrReviewCommentResult>;

export interface ReviewRunProcessor {
  process(
    run: QueuedReviewRunRow,
    activeSessions: Map<string, ActiveSession>,
  ): Promise<void>;
}

export function prepareRunContext(
  deps: Pick<CreateReviewRunProcessorOptions, 'config' | 'registry'>,
  run: QueuedReviewRunRow,
): PreparedRun | { error: string } {
  const spec = deps.registry.get(run.agent as AgentName);
  if (!spec) {
    return { error: `No runtime spec registered for agent ${run.agent}` };
  }

  const trigger = buildTriggerContextFromPayload(
    run.path,
    run.trigger_id,
    run.payload_json,
  );

  const runtimeRun = {
    id: run.id,
    repo_id: run.repo_id,
    trigger_event_id: run.trigger_event_id,
    trigger_id: run.trigger_id as 'commit' | 'pr' | 'manual',
    scope: run.scope as 'commit-diff' | 'workspace-diff' | 'repo' | 'pr',
    path: run.path,
    default_branch: run.default_branch,
  };

  const prepared = spec.prepareContext({
    config: deps.config,
    run: runtimeRun,
    trigger,
  });
  const prompt = spec.buildPrompt({ preparedContext: prepared });
  const modelID = spec.modelId(deps.config);
  const modelOverride = parseModelOverride(modelID);

  return { spec, prompt, modelOverride, runtimeRun };
}

export async function executeSession(
  deps: Pick<CreateReviewRunProcessorOptions, 'client' | 'completionBus'>,
  run: QueuedReviewRunRow,
  prepared: PreparedRun,
  runner: ProcessorRunnerDeps,
  onSessionCreated?: (sessionId: string) => void,
): Promise<SessionResult> {
  const existingSessionId =
    typeof run.session_id === 'string' && run.session_id.length > 0
      ? run.session_id
      : undefined;
  const sessionId =
    existingSessionId ??
    (await runner.createReviewSession(deps.client, {
      title: `[${prepared.spec.agent}] ${run.subject || run.id}`,
      directory: run.path,
    }));

  if (!existingSessionId) {
    onSessionCreated?.(sessionId);
  }

  const completion = deps.completionBus.waitFor(sessionId, {
    directory: run.path,
  });

  await runner.promptReviewAsync(deps.client, {
    sessionId,
    directory: run.path,
    agent: prepared.spec.agent,
    prompt: prepared.prompt,
    modelOverride: prepared.modelOverride,
  });

  const completionResult = await completion;
  if (completionResult.type !== 'idle') {
    const classification = classifyCompletionFailure(completionResult.type);
    throw new Error(
      `${classification.errorCode}: ${completionResult.message ?? completionResult.type}`,
    );
  }

  const rawOutput = await runner.fetchAssistantOutput(deps.client, {
    sessionId,
    directory: run.path,
  });

  return { sessionId, rawOutput };
}

export interface CreateReviewRunProcessorOptions {
  db: Database;
  config: CliConfig;
  registry: AgentRuntimeRegistry;
  client: OpencodeClient;
  completionBus: SessionCompletionBus;
  persistence: ReviewRunPersistenceService;
  runner?: Partial<ProcessorRunnerDeps>;
  prCommentPublisher?: PrReviewCommentPublisher;
}

export function createReviewRunProcessor(
  options: CreateReviewRunProcessorOptions,
): ReviewRunProcessor {
  const runner: ProcessorRunnerDeps = {
    abortSession,
    createReviewSession,
    fetchAssistantOutput,
    promptReviewAsync,
    ...options.runner,
  };
  const publishPrComment = options.prCommentPublisher ?? postPrReviewComment;

  return {
    async process(run, activeSessions) {
      const prepared = prepareRunContext(options, run);
      if ('error' in prepared) {
        options.persistence.persistMissingRuntimeSpec(run, prepared.error);
        return;
      }

      let sessionId: string | undefined;
      try {
        if (run.session_id) {
          sessionId = run.session_id;
          activeSessions.set(run.id, { sessionId, directory: run.path });
        }

        const session = await executeSession(
          options,
          run,
          prepared,
          runner,
          (sid) => {
            sessionId = sid;
            markReviewRunRunning(options.db, run.id, sid);
            activeSessions.set(run.id, { sessionId: sid, directory: run.path });
          },
        );
        sessionId = session.sessionId;

        if (!activeSessions.has(run.id)) {
          activeSessions.set(run.id, { sessionId, directory: run.path });
        }

        const findings = buildFindingsFromParsedOutput(
          prepared.spec,
          prepared.runtimeRun,
          run.id,
          session.rawOutput,
        );
        options.persistence.persistSucceeded(run, session, findings);

        if (run.trigger_id === 'pr' && options.config.triggers.pr.postComment) {
          const result = await publishPrComment(run, findings);
          if (result.ok) {
            appendEvent(options.db, {
              eventType: 'review_run.pr_comment_posted',
              repoId: run.repo_id,
              triggerEventId: run.trigger_event_id,
              reviewRunId: run.id,
              message: `Posted PR comment for review run ${run.id}`,
              payload: {
                agent: run.agent,
                prNumber: result.prNumber,
                reviewRunId: run.id,
              },
            });
          } else {
            appendEvent(options.db, {
              eventType: 'review_run.pr_comment_failed',
              level: 'warn',
              repoId: run.repo_id,
              triggerEventId: run.trigger_event_id,
              reviewRunId: run.id,
              message: `Failed to post PR comment for review run ${run.id}: ${result.error}`,
              payload: {
                agent: run.agent,
                ...(result.prNumber !== undefined
                  ? { prNumber: result.prNumber }
                  : {}),
                error: result.error,
                reviewRunId: run.id,
              },
            });
          }
        }
      } catch (error) {
        if (sessionId) {
          options.completionBus.cancel(sessionId, 'review run failed');
          await runner.abortSession(options.client, sessionId, run.path);
        }
        options.persistence.persistFailureOrRetry(run, error);
      } finally {
        activeSessions.delete(run.id);
      }
    },
  };
}
