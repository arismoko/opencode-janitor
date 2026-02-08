import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import type { ReviewJob, ReviewResult } from '../types';
import { parseReviewOutput } from '../results/parser';
import { formatReport } from '../results/formatter';
import { deliverToast } from '../results/sinks/toast-sink';
import { deliverToSession } from '../results/sinks/session-sink';
import { deliverToFile } from '../results/sinks/file-sink';
import { log, warn } from '../utils/logger';

type ReviewExecutor = (sha: string) => Promise<string | null>;

/**
 * Review orchestrator managing the queue and lifecycle of reviews.
 *
 * Policies:
 * - Serial execution (concurrency=1 default)
 * - Burst coalescing: keeps oldest running + latest pending
 * - Running reviews are never cancelled
 */
export class ReviewOrchestrator {
  private jobs = new Map<string, ReviewJob>();
  private sessionToSha = new Map<string, string>();
  private queue: string[] = [];
  private activeCount = 0;

  constructor(
    private config: JanitorConfig,
    private executor: ReviewExecutor,
  ) {}

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

      try {
        const sessionId = await this.executor(sha);
        if (sessionId) {
          job.sessionId = sessionId;
          this.sessionToSha.set(sessionId, sha);
          log(`[orchestrator] review started: ${sha} → ${sessionId}`);
        } else {
          job.status = 'failed';
          job.error = 'No parent session available';
          this.activeCount--;
          this.processQueue();
        }
      } catch (err) {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        job.completedAt = new Date();
        this.activeCount--;
        warn(`[orchestrator] review failed to start: ${sha} — ${job.error}`);
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
      const result = parseReviewOutput(rawOutput, sha);

      job.status = 'completed';
      job.completedAt = new Date();
      job.result = result;

      // Deliver results via configured sinks
      await this.deliverResults(result, job.sessionId, ctx, config);
    } catch (err) {
      job.status = 'failed';
      job.completedAt = new Date();
      job.error = err instanceof Error ? err.message : String(err);
      warn(`[orchestrator] result extraction failed: ${sha} — ${job.error}`);
    } finally {
      this.sessionToSha.delete(sessionId);
      this.activeCount--;
      this.processQueue();
    }
  }

  /**
   * Deliver review results to all configured sinks.
   */
  private async deliverResults(
    result: ReviewResult,
    _sessionId: string | undefined,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void> {
    const report = formatReport(result);

    if (config.delivery.toast) {
      await deliverToast(ctx, result);
    }

    if (config.delivery.sessionMessage) {
      // Find the current root session to deliver to
      await deliverToSession(ctx, report);
    }

    if (config.delivery.reportFile) {
      await deliverToFile(result, report, config.delivery.reportDir, ctx.directory);
    }
  }
}
