import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import type { EnrichmentData } from '../history/enrichment';
import type { HistoryStore } from '../history/store';
import { formatReport } from '../results/formatter';
import { processReviewOutput } from '../results/pipeline';
import { deliverToFile } from '../results/sinks/file-sink';
import { deliverToSession } from '../results/sinks/session-sink';
import { deliverToast } from '../results/sinks/toast-sink';
import type { SuppressionStore } from '../suppressions/store';
import type { ReviewJob, ReviewResult } from '../types';
import { log, warn } from '../utils/logger';
import { notifyError } from '../utils/notifier';

/**
 * Thrown by the executor when no root session is available to host the review.
 * The orchestrator catches this specifically and keeps the job pending for retry
 * rather than marking it as permanently failed.
 */
class NoSessionError extends Error {
  constructor() {
    super('No root session available');
    this.name = 'NoSessionError';
  }
}

type ReviewExecutor = (sha: string, parentSessionId: string) => Promise<string>;

/**
 * Review orchestrator managing the queue and lifecycle of reviews.
 *
 * Policies:
 * - Serial execution (concurrency=1 default)
 * - Burst coalescing: keeps oldest running + latest pending
 * - Running reviews are never cancelled
 * - Jobs waiting for a session are re-queued, not dropped
 */
export class ReviewOrchestrator {
  private jobs = new Map<string, ReviewJob>();
  private sessionToSha = new Map<string, string>();
  private queue: string[] = [];
  private activeCount = 0;
  private onReviewCompleted?: (sha: string) => void;
  /** Most recently observed root session, used to assign to new/pending jobs. */
  private latestSessionId?: string;
  private ctx?: PluginInput;
  private suppressionStore?: SuppressionStore;
  private historyStore?: HistoryStore;

  constructor(
    private config: JanitorConfig,
    private executor: ReviewExecutor,
  ) {}

  /** Register a callback invoked when a review completes successfully. */
  onCompleted(callback: (sha: string) => void): void {
    this.onReviewCompleted = callback;
  }

  /** Set the plugin context for error notification injection. */
  setContext(ctx: PluginInput): void {
    this.ctx = ctx;
  }

  /** Set memory stores for suppression + history pipeline processing. */
  setStores(
    suppressionStore: SuppressionStore,
    historyStore: HistoryStore,
  ): void {
    this.suppressionStore = suppressionStore;
    this.historyStore = historyStore;
  }

  /**
   * Notify the orchestrator that a root session is now available.
   * Assigns the session to any pending jobs that lack one, then drains the queue.
   * Idempotent — repeated calls with the same ID are no-ops.
   */
  sessionAvailable(sessionId: string): void {
    if (sessionId === this.latestSessionId) return;
    this.latestSessionId = sessionId;

    // Backfill pending jobs that were queued before any session existed
    for (const sha of this.queue) {
      const job = this.jobs.get(sha);
      if (job && job.status === 'pending' && !job.parentSessionId) {
        job.parentSessionId = sessionId;
      }
    }

    log('[orchestrator] root session available, draining queue');
    this.processQueue();
  }

  /**
   * Enqueue a commit for review.
   * Applies burst coalescing if dropIntermediate is enabled.
   */
  enqueue(sha: string): void {
    // Already processing this SHA
    if (this.jobs.has(sha)) {
      log(`[orchestrator] already tracking: ${sha}`);
      return;
    }

    const job: ReviewJob = {
      sha,
      parentSessionId: this.latestSessionId,
      status: 'pending',
      enqueuedAt: new Date(),
    };
    this.jobs.set(sha, job);

    // Burst coalescing: drop intermediate pending jobs
    if (this.config.queue.dropIntermediate && this.queue.length > 0) {
      const dropped = this.queue.splice(0, this.queue.length);
      for (const droppedSha of dropped) {
        const droppedJob = this.jobs.get(droppedSha);
        if (droppedJob && droppedJob.status === 'pending') {
          this.jobs.delete(droppedSha);
          log(`[orchestrator] dropped intermediate: ${droppedSha}`);
        }
      }
    }

    this.queue.push(sha);
    log(`[orchestrator] enqueued: ${sha}`);
    this.processQueue();
  }

  /**
   * Process the queue, starting reviews up to concurrency limit.
   */
  private async processQueue(): Promise<void> {
    while (
      this.activeCount < this.config.queue.concurrency &&
      this.queue.length > 0
    ) {
      const sha = this.queue.shift();
      if (!sha) break;

      const job = this.jobs.get(sha);
      if (!job || job.status !== 'pending') continue;

      this.activeCount++;
      job.status = 'running';
      job.startedAt = new Date();

      // Each job targets the session that was active when it was enqueued.
      // If no session was available at enqueue time, NoSessionError re-queues it.
      const targetSession = job.parentSessionId;

      try {
        if (!targetSession) {
          throw new NoSessionError();
        }
        const sessionId = await this.executor(sha, targetSession);
        job.sessionId = sessionId;
        this.sessionToSha.set(sessionId, sha);
        log(`[orchestrator] review started: ${sha} → ${sessionId}`);
      } catch (err) {
        this.activeCount--;

        if (err instanceof NoSessionError) {
          // No session yet — put the job back at the front of the queue
          // so it's retried when sessionAvailable() is called.
          job.status = 'pending';
          job.startedAt = undefined;
          this.queue.unshift(sha);
          log(`[orchestrator] no session, re-queued: ${sha}`);
          return; // Don't process more — we'll retry when a session appears
        }

        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        job.completedAt = new Date();
        this.jobs.delete(sha);
        warn(`[orchestrator] review failed to start: ${sha} — ${job.error}`);

        // Surface the error to the user in their originating session
        if (this.ctx && targetSession) {
          notifyError(
            this.ctx,
            targetSession,
            `Review failed for commit \`${sha.slice(0, 8)}\``,
            err,
          ).catch(() => {}); // fire-and-forget
        }

        this.processQueue();
      }
    }
  }

  /**
   * Handle session completion event.
   * Extracts results from the review session and delivers them.
   */
  async handleCompletion(
    sessionId: string,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void> {
    const sha = this.sessionToSha.get(sessionId);
    if (!sha) return; // Not our session

    const job = this.jobs.get(sha);
    if (!job || job.status !== 'running') return;

    log(`[orchestrator] review completed: ${sha}`);

    try {
      // Extract assistant output from session
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

      // Process through the full pipeline (parse → suppress → annotate → record)
      let result: ReviewResult;
      let enrichment: EnrichmentData | undefined;
      let suppressedCount = 0;

      if (this.suppressionStore && this.historyStore) {
        const pipelineResult = await processReviewOutput(rawOutput, sha, {
          suppressionStore: this.suppressionStore,
          historyStore: this.historyStore,
          config,
        });
        result = pipelineResult.result;
        enrichment = pipelineResult.enrichment;
        suppressedCount = pipelineResult.suppressedCount;
      } else {
        // Fallback: parse-only when stores aren't available
        const { parseReviewOutput } = await import('../results/parser');
        result = parseReviewOutput(rawOutput, sha);
      }

      job.status = 'completed';
      job.completedAt = new Date();
      job.result = result;

      // Persist the SHA as processed only after successful completion
      this.onReviewCompleted?.(sha);

      // Deliver results via configured sinks
      await this.deliverResults(
        result,
        job.parentSessionId,
        ctx,
        config,
        enrichment,
        suppressedCount,
      );
    } catch (err) {
      job.status = 'failed';
      job.completedAt = new Date();
      job.error = err instanceof Error ? err.message : String(err);
      warn(`[orchestrator] result extraction failed: ${sha} — ${job.error}`);

      // Surface extraction failure to the user in their originating session
      if (this.ctx && job.parentSessionId) {
        notifyError(
          this.ctx,
          job.parentSessionId,
          `Failed to extract review results for \`${sha.slice(0, 8)}\``,
          err,
        ).catch(() => {}); // fire-and-forget
      }
    } finally {
      this.sessionToSha.delete(sessionId);
      this.activeCount--;
      // Prune terminal jobs to prevent unbounded growth
      this.jobs.delete(sha);
      this.processQueue();
    }
  }

  /**
   * Deliver review results to all configured sinks.
   */
  private async deliverResults(
    result: ReviewResult,
    parentSessionId: string | undefined,
    ctx: PluginInput,
    config: JanitorConfig,
    enrichment?: EnrichmentData,
    suppressedCount?: number,
  ): Promise<void> {
    const report = formatReport(result, enrichment, suppressedCount);

    if (config.delivery.toast) {
      await deliverToast(ctx, result, enrichment);
    }

    if (config.delivery.sessionMessage && parentSessionId) {
      await deliverToSession(ctx, parentSessionId, report, enrichment);
    }

    if (config.delivery.reportFile) {
      await deliverToFile(
        result,
        report,
        config.delivery.reportDir,
        ctx.directory,
        enrichment,
      );
    }
  }
}
