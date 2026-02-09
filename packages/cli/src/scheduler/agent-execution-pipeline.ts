import type { Database } from 'bun:sqlite';
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { CommitContext } from '@opencode-janitor/shared';
import type { CliConfig } from '../config/schema';
import type {
  AgentRunOutcome,
  AgentRunSummary,
  QueuedJobRow,
} from '../db/models';
import {
  createAgentRun,
  insertFindingRows,
  markAgentRunFailed,
  markAgentRunRunning,
  markAgentRunSucceeded,
} from '../db/queries';
import {
  abortSession,
  createReviewSession,
  fetchAssistantOutput,
  parseModelOverride,
  promptReviewAsync,
} from '../reviews/runner';
import type { AgentRuntimeSpec } from '../runtime/agent-runtime-spec';
import type { SessionCompletionBus } from '../runtime/session-completion-bus';
import {
  classifyAgentFailure,
  classifyCompletionFailure,
  type FailureClassification,
} from './retry-policy';

const AGENT_COMPLETION_TIMEOUT_MS = 180_000;

export interface AgentRunResult {
  success: boolean;
  findingsCount: number;
  outcome: AgentRunOutcome;
  retryable: boolean;
  errorCode?: string;
  errorType?: 'transient' | 'terminal' | 'cancelled';
  errorMessage?: string;
  summary: AgentRunSummary;
}

export interface AgentExecutionPipelineDeps {
  db: Database;
  client: OpencodeClient;
  config: CliConfig;
  completionBus: SessionCompletionBus;
}

export interface AgentExecutionPipeline {
  execute(
    job: QueuedJobRow,
    spec: AgentRuntimeSpec,
    commitSha: string,
    commitContext: CommitContext,
  ): Promise<AgentRunResult>;
  cancelActiveSessions(message?: string): Promise<void>;
}

interface ActiveSession {
  directory: string;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class ClassifiedAgentFailureError extends Error {
  readonly classification: FailureClassification;

  constructor(classification: FailureClassification, message: string) {
    super(message);
    this.classification = classification;
    this.name = 'ClassifiedAgentFailureError';
  }
}

export function createAgentExecutionPipeline(
  deps: AgentExecutionPipelineDeps,
): AgentExecutionPipeline {
  const { db, client, config, completionBus } = deps;
  const activeSessions = new Map<string, ActiveSession>();

  return {
    async execute(job, spec, commitSha, commitContext) {
      const modelId = spec.modelId(config);
      const modelOverride = parseModelOverride(modelId);
      const startedAt = Date.now();

      const runId = createAgentRun(db, {
        jobId: job.id,
        agent: spec.agent,
        modelId: modelId || undefined,
        variant: spec.variant(config),
      });

      let sessionId: string | undefined;
      let completionType: AgentRunSummary['completion'] = 'unknown';

      try {
        const preparedContext = spec.prepareContext({
          config,
          job,
          triggerKind: job.kind,
          commitSha,
          commitContext,
        });
        const userPrompt = spec.buildPrompt({ preparedContext });

        sessionId = await createReviewSession(client, {
          title: `[${spec.agent}] ${job.subject_key || commitSha.slice(0, 10)}`,
          directory: job.path,
        });

        markAgentRunRunning(db, runId, sessionId);
        activeSessions.set(sessionId, { directory: job.path });

        const completion = completionBus.waitFor(sessionId, {
          directory: job.path,
          timeoutMs: AGENT_COMPLETION_TIMEOUT_MS,
        });

        await promptReviewAsync(client, {
          sessionId,
          directory: job.path,
          agent: spec.agent,
          prompt: userPrompt,
          modelOverride,
        });

        const outcome = await completion;
        completionType = outcome.type;
        if (outcome.type !== 'idle') {
          const classification = classifyCompletionFailure(outcome.type);
          throw new ClassifiedAgentFailureError(
            classification,
            `session completion failed for ${spec.agent}: ${outcome.message}`,
          );
        }

        const rawOutput = await fetchAssistantOutput(client, {
          sessionId,
          directory: job.path,
        });

        const parsedOutput = spec.parseOutput(rawOutput);
        const findingRows = spec.onSuccess({
          job,
          runId,
          output: parsedOutput,
        });

        const summary: AgentRunSummary = {
          outcome: 'succeeded',
          retryable: false,
          findingsCount: findingRows.length,
          durationMs: Date.now() - startedAt,
          sessionId: sessionId ?? null,
          completion: completionType,
        };

        db.transaction(() => {
          insertFindingRows(db, findingRows);
          markAgentRunSucceeded(
            db,
            runId,
            findingRows.length,
            rawOutput,
            summary,
          );
        })();

        return {
          success: true,
          findingsCount: findingRows.length,
          outcome: 'succeeded',
          retryable: false,
          summary,
        };
      } catch (error) {
        const classified =
          error instanceof ClassifiedAgentFailureError
            ? error.classification
            : classifyAgentFailure(error);
        const message = toErrorMessage(error);

        if (sessionId) {
          completionBus.cancel(sessionId, 'agent run aborted');
          await abortSession(client, sessionId, job.path);
        }

        const summary: AgentRunSummary = {
          outcome: classified.outcome,
          retryable: classified.retryable,
          findingsCount: 0,
          durationMs: Date.now() - startedAt,
          sessionId: sessionId ?? null,
          completion: completionType,
          errorCode: classified.errorCode,
          errorMessage: message,
        };

        markAgentRunFailed(db, runId, classified.errorCode, message, summary);
        return {
          success: false,
          findingsCount: 0,
          outcome: classified.outcome,
          retryable: classified.retryable,
          errorCode: classified.errorCode,
          errorType: classified.errorType,
          errorMessage: message,
          summary,
        };
      } finally {
        if (sessionId) {
          activeSessions.delete(sessionId);
        }
      }
    },

    async cancelActiveSessions(message = 'scheduler stopping') {
      const sessions = [...activeSessions.entries()];

      await Promise.allSettled(
        sessions.map(([sessionId, active]) => {
          completionBus.cancel(sessionId, message);
          return abortSession(client, sessionId, active.directory);
        }),
      );
    },
  };
}
