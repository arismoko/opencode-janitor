import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import type { PrContext } from '../git/pr-context-resolver';
import { formatReviewerReport } from '../results/reviewer-formatter';
import {
  parseReviewerOutput,
  type ReviewerResult,
} from '../results/reviewer-parser';
import { deliverReviewerToFile } from '../results/sinks/reviewer-file-sink';
import { deliverReviewerToSession } from '../results/sinks/reviewer-session-sink';
import { deliverReviewerToast } from '../results/sinks/reviewer-toast-sink';
import { log, warn } from '../utils/logger';
import { notifyError } from '../utils/notifier';

class NoSessionError extends Error {
  constructor() {
    super('No root session available');
    this.name = 'NoSessionError';
  }
}

interface ReviewerJob {
  key: string;
  context: PrContext;
  parentSessionId?: string;
  sessionId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  enqueuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: ReviewerResult;
  error?: string;
}

type ReviewerExecutor = (
  context: PrContext,
  parentSessionId: string,
) => Promise<string>;

type GhPostReview = (prNumber: number, body: string) => Promise<boolean>;

/**
 * Orchestrates comprehensive reviewer jobs (primarily PR reviews).
 */
export class ReviewerOrchestrator {
  private jobs = new Map<string, ReviewerJob>();
  private sessionToKey = new Map<string, string>();
  private queue: string[] = [];
  private activeCount = 0;
  private latestSessionId?: string;
  private ctx?: PluginInput;

  constructor(
    private readonly config: JanitorConfig,
    private readonly executor: ReviewerExecutor,
    private readonly postGhReview?: GhPostReview,
  ) {}

  setContext(ctx: PluginInput): void {
    this.ctx = ctx;
  }

  isOwnSession(sessionId: string): boolean {
    return this.sessionToKey.has(sessionId);
  }

  sessionAvailable(sessionId: string): void {
    if (sessionId === this.latestSessionId) return;
    this.latestSessionId = sessionId;

    for (const key of this.queue) {
      const job = this.jobs.get(key);
      if (job && job.status === 'pending' && !job.parentSessionId) {
        job.parentSessionId = sessionId;
      }
    }

    log('[reviewer-orchestrator] root session available, draining queue');
    this.processQueue();
  }

  enqueue(context: PrContext): void {
    const key = context.key;
    if (this.jobs.has(key)) {
      log(`[reviewer-orchestrator] already tracking: ${key}`);
      return;
    }

    const job: ReviewerJob = {
      key,
      context,
      parentSessionId: this.latestSessionId,
      status: 'pending',
      enqueuedAt: new Date(),
    };
    this.jobs.set(key, job);

    if (this.config.queue.dropIntermediate && this.queue.length > 0) {
      const dropped = this.queue.splice(0, this.queue.length);
      for (const droppedKey of dropped) {
        const droppedJob = this.jobs.get(droppedKey);
        if (droppedJob && droppedJob.status === 'pending') {
          this.jobs.delete(droppedKey);
          log(`[reviewer-orchestrator] dropped intermediate: ${droppedKey}`);
        }
      }
    }

    this.queue.push(key);
    log(`[reviewer-orchestrator] enqueued: ${key}`);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    while (
      this.activeCount < this.config.queue.concurrency &&
      this.queue.length > 0
    ) {
      const key = this.queue.shift();
      if (!key) break;

      const job = this.jobs.get(key);
      if (!job || job.status !== 'pending') continue;

      this.activeCount++;
      job.status = 'running';
      job.startedAt = new Date();

      const targetSession = job.parentSessionId;

      try {
        if (!targetSession) {
          throw new NoSessionError();
        }

        const sessionId = await this.executor(job.context, targetSession);
        job.sessionId = sessionId;
        this.sessionToKey.set(sessionId, key);
        log(`[reviewer-orchestrator] review started: ${key} -> ${sessionId}`);
      } catch (err) {
        this.activeCount--;

        if (err instanceof NoSessionError) {
          job.status = 'pending';
          job.startedAt = undefined;
          this.queue.unshift(key);
          log(`[reviewer-orchestrator] no session, re-queued: ${key}`);
          return;
        }

        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        job.completedAt = new Date();
        this.jobs.delete(key);
        warn(`[reviewer-orchestrator] failed to start: ${key} — ${job.error}`);

        if (this.ctx && targetSession) {
          notifyError(
            this.ctx,
            targetSession,
            `Code review failed to start for \`${key}\``,
            err,
          ).catch(() => {});
        }

        this.processQueue();
      }
    }
  }

  async handleCompletion(
    sessionId: string,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void> {
    const key = this.sessionToKey.get(sessionId);
    if (!key) return;

    const job = this.jobs.get(key);
    if (!job || job.status !== 'running') return;

    job.status = 'completed';
    log(`[reviewer-orchestrator] review completed: ${key}`);

    try {
      const messagesResult = await ctx.client.session.messages({
        path: { id: sessionId },
      });
      const messages = (messagesResult.data ?? []) as Array<{
        info?: { role: string };
        parts?: Array<{ type: string; text?: string }>;
      }>;

      const assistantTexts: string[] = [];
      for (const msg of messages) {
        if (msg.info?.role !== 'assistant') continue;
        for (const part of msg.parts ?? []) {
          if (part.type === 'text' && part.text) {
            assistantTexts.push(part.text);
          }
        }
      }

      const rawOutput = assistantTexts.join('\n\n');
      const result = parseReviewerOutput(rawOutput, key);
      const report = formatReviewerReport(result);

      job.completedAt = new Date();
      job.result = result;

      await this.deliverResults(result, report, job, ctx, config);
    } catch (err) {
      job.status = 'failed';
      job.completedAt = new Date();
      job.error = err instanceof Error ? err.message : String(err);
      warn(`[reviewer-orchestrator] extraction failed: ${key} — ${job.error}`);

      if (this.ctx && job.parentSessionId) {
        notifyError(
          this.ctx,
          job.parentSessionId,
          `Failed to extract code review results for \`${key}\``,
          err,
        ).catch(() => {});
      }
    } finally {
      this.sessionToKey.delete(sessionId);
      this.activeCount--;
      this.jobs.delete(key);
      this.processQueue();
    }
  }

  private async deliverResults(
    result: ReviewerResult,
    report: string,
    job: ReviewerJob,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void> {
    const delivery = config.delivery.reviewer;

    if (delivery.toast) {
      await deliverReviewerToast(ctx, result);
    }

    if (delivery.sessionMessage && job.parentSessionId) {
      await deliverReviewerToSession(ctx, job.parentSessionId, report);
    }

    if (delivery.reportFile) {
      await deliverReviewerToFile(
        result,
        report,
        delivery.reportDir,
        ctx.directory,
      );
    }

    if (
      delivery.prComment &&
      config.pr.postWithGh &&
      this.postGhReview &&
      typeof job.context.number === 'number'
    ) {
      const posted = await this.postGhReview(job.context.number, report);
      if (posted) {
        log(
          `[reviewer-orchestrator] posted GH review for PR #${job.context.number}`,
        );
      }
    }
  }
}
