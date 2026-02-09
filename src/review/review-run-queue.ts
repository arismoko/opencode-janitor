import type { PluginInput } from '@opencode-ai/plugin';
import type { Message, Part } from '@opencode-ai/sdk';
import type { JanitorConfig } from '../config/schema';
import { getErrorMessage, log, warn } from '../utils/logger';
import { notifyError } from '../utils/notifier';

/** Shared job lifecycle fields used by both review strategies. */
export interface BaseJob<TContext, TResult> {
  key: string;
  context: TContext;
  parentSessionId?: string;
  sessionId?: string;
  status:
    | 'pending'
    | 'starting'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled';
  cancelRequested?: boolean;
  enqueuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: TResult;
  error?: string;
}

/** Strategy interface — agent-specific logic injected into ReviewRunQueue. */
export interface ReviewStrategy<TContext, TResult> {
  /** Derive dedup key from context */
  extractKey(context: TContext): string;
  /** Human-readable label for error messages */
  errorLabel(key: string): string;
  /** Called when a review session completes — parse results, deliver outputs */
  onJobCompleted(
    job: BaseJob<TContext, TResult>,
    sessionId: string,
    ctx: PluginInput,
    config: JanitorConfig,
    extractAssistantOutput: (
      sessionId: string,
      ctx: PluginInput,
    ) => Promise<string>,
  ): Promise<void>;
}

type Executor<TContext> = (
  context: TContext,
  parentSessionId?: string,
) => Promise<string>;

/**
 * Concrete review queue managing the lifecycle of review jobs.
 *
 * Policies:
 * - Serial execution (concurrency=1 default)
 * - Burst coalescing: keeps oldest running + latest pending
 * - Running reviews can be explicitly cancelled by user command
 * - Review execution never blocks on user root sessions
 *
 * Agent-specific logic (key extraction, result parsing, delivery) is
 * delegated to a {@link ReviewStrategy} passed at construction.
 */
export class ReviewRunQueue<TContext, TResult> {
  private jobs = new Map<string, BaseJob<TContext, TResult>>();
  private sessionToKey = new Map<string, string>();
  private queue: string[] = [];
  private activeCount = 0;
  private halted = false;
  private ctx?: PluginInput;
  private completedCallback?: (key: string) => void;

  private readonly tag: string;

  constructor(
    private readonly config: JanitorConfig,
    private readonly executor: Executor<TContext>,
    private readonly strategy: ReviewStrategy<TContext, TResult>,
    tag: string,
  ) {
    this.tag = tag;
  }

  /** Register a callback invoked after each successful job completion. */
  onCompleted(callback: (key: string) => void): void {
    this.completedCallback = callback;
  }

  /** Set the plugin context for error notification injection. */
  setContext(ctx: PluginInput): void {
    this.ctx = ctx;
  }

  /** Snapshot current jobs for command/status views. */
  getJobsSnapshot(): Array<
    Pick<
      BaseJob<TContext, TResult>,
      | 'key'
      | 'status'
      | 'sessionId'
      | 'parentSessionId'
      | 'enqueuedAt'
      | 'startedAt'
    >
  > {
    return [...this.jobs.values()].map((job) => ({
      key: job.key,
      status: job.status,
      sessionId: job.sessionId,
      parentSessionId: job.parentSessionId,
      enqueuedAt: job.enqueuedAt,
      startedAt: job.startedAt,
    }));
  }

  /** Drop all pending jobs from the queue. Running jobs are untouched. */
  clearPending(): number {
    let dropped = 0;
    const keys = [...this.queue];
    this.queue = [];
    for (const key of keys) {
      const job = this.jobs.get(key);
      if (!job || job.status !== 'pending') continue;
      this.jobs.delete(key);
      dropped++;
    }
    return dropped;
  }

  /** Abort all currently running sessions owned by this queue. */
  async abortRunning(ctx: PluginInput): Promise<number> {
    let aborted = 0;
    for (const job of [...this.jobs.values()]) {
      if (job.status !== 'running' && job.status !== 'starting') continue;
      if (!job.sessionId) {
        job.cancelRequested = true;
        aborted++;
        continue;
      }
      try {
        await ctx.client.session.abort({
          path: { id: job.sessionId },
          query: { directory: ctx.directory },
        });
        job.status = 'cancelled';
        job.completedAt = new Date();
        this.sessionToKey.delete(job.sessionId);
        this.jobs.delete(job.key);
        this.activeCount = Math.max(0, this.activeCount - 1);
        aborted++;
      } catch {
        warn(`[${this.tag}] failed to abort session: ${job.sessionId}`);
      }
    }
    if (aborted > 0) {
      this.processQueue();
    }
    return aborted;
  }

  /**
   * Enqueue a context for review.
   * Applies burst coalescing if dropIntermediate is enabled.
   */
  enqueue(context: TContext, parentSessionId?: string): void {
    if (this.halted) {
      log(`[${this.tag}] enqueue ignored while halted`);
      return;
    }

    const key = this.strategy.extractKey(context);

    // Already processing this key
    if (this.jobs.has(key)) {
      log(`[${this.tag}] already tracking: ${key}`);
      return;
    }

    const job: BaseJob<TContext, TResult> = {
      key,
      context,
      parentSessionId,
      status: 'pending',
      enqueuedAt: new Date(),
    };
    this.jobs.set(key, job);

    // Burst coalescing: drop intermediate pending jobs
    if (this.config.queue.dropIntermediate && this.queue.length > 0) {
      const dropped = this.queue.splice(0, this.queue.length);
      for (const droppedKey of dropped) {
        const droppedJob = this.jobs.get(droppedKey);
        if (droppedJob && droppedJob.status === 'pending') {
          this.jobs.delete(droppedKey);
          log(`[${this.tag}] dropped intermediate: ${droppedKey}`);
        }
      }
    }

    this.queue.push(key);
    log(`[${this.tag}] enqueued: ${key}`);
    this.processQueue();
  }

  /**
   * Process the queue, starting reviews up to concurrency limit.
   */
  private async processQueue(): Promise<void> {
    while (
      !this.halted &&
      this.activeCount < this.config.queue.concurrency &&
      this.queue.length > 0
    ) {
      const key = this.queue.shift();
      if (!key) break;

      const job = this.jobs.get(key);
      if (!job || job.status !== 'pending') continue;

      this.activeCount++;
      job.status = 'starting';
      job.startedAt = new Date();

      try {
        const sessionId = await this.executor(job.context, job.parentSessionId);

        if (job.cancelRequested) {
          if (this.ctx) {
            try {
              await this.ctx.client.session.abort({
                path: { id: sessionId },
                query: { directory: this.ctx.directory },
              });
            } catch {
              // Best effort; session may already be terminal.
            }
          }
          job.status = 'cancelled';
          job.completedAt = new Date();
          this.jobs.delete(key);
          this.activeCount = Math.max(0, this.activeCount - 1);
          log(`[${this.tag}] cancelled during startup: ${key} → ${sessionId}`);
          this.processQueue();
          continue;
        }

        job.status = 'running';
        job.sessionId = sessionId;
        this.sessionToKey.set(sessionId, key);
        log(`[${this.tag}] review started: ${key} → ${sessionId}`);
      } catch (err) {
        this.activeCount--;

        job.status = 'failed';
        job.error = getErrorMessage(err);
        job.completedAt = new Date();
        this.jobs.delete(key);
        warn(`[${this.tag}] review failed to start: ${key} — ${job.error}`);

        // Surface the error to the user in their originating session
        if (this.ctx && job.parentSessionId) {
          notifyError(
            this.ctx,
            job.parentSessionId,
            `Review failed for ${this.strategy.errorLabel(key)}`,
            err,
          ).catch(() => {}); // fire-and-forget
        }

        this.processQueue();
      }
    }
  }

  /** Halt new queue work for runtime teardown. */
  shutdown(): void {
    this.halted = true;
  }

  /**
   * Handle session completion event.
   * Delegates to strategy `onJobCompleted` for result extraction and delivery.
   */
  async handleCompletion(
    sessionId: string,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void> {
    const key = this.sessionToKey.get(sessionId);
    if (!key) return; // Not our session

    const job = this.jobs.get(key);
    if (!job || job.status !== 'running') return;

    // Atomically transition to prevent duplicate idle events from double-processing.
    // JS is single-threaded but the method is async — a second call arriving between
    // awaits would see 'running' without this guard.
    job.status = 'completed';

    log(`[${this.tag}] review completed: ${key}`);

    try {
      await this.strategy.onJobCompleted(
        job,
        sessionId,
        ctx,
        config,
        this.extractAssistantOutput.bind(this),
      );
      this.completedCallback?.(key);
    } catch (err) {
      job.status = 'failed';
      job.completedAt = new Date();
      job.error = getErrorMessage(err);
      warn(`[${this.tag}] result extraction failed: ${key} — ${job.error}`);

      // Surface extraction failure to the user in their originating session
      if (this.ctx && job.parentSessionId) {
        notifyError(
          this.ctx,
          job.parentSessionId,
          `Failed to extract review results for ${this.strategy.errorLabel(key)}`,
          err,
        ).catch(() => {}); // fire-and-forget
      }
    } finally {
      this.sessionToKey.delete(sessionId);
      this.activeCount--;
      // Prune terminal jobs to prevent unbounded growth
      this.jobs.delete(key);
      this.processQueue();
    }
  }

  /**
   * Handle session failure event.
   * Releases the job so the queue is unblocked.
   */
  handleFailure(sessionId: string, error: string): void {
    const key = this.sessionToKey.get(sessionId);
    if (!key) return; // Not our session

    const job = this.jobs.get(key);
    if (!job || (job.status !== 'running' && job.status !== 'starting')) return;

    job.status = 'failed';
    job.error = error;
    job.completedAt = new Date();

    this.sessionToKey.delete(sessionId);
    this.jobs.delete(job.key);
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.processQueue();

    warn(`[${this.tag}] session failed: ${key} — ${error}`);
  }

  /**
   * Extract assistant text output from a completed review session.
   * Passed as a callback to strategies so they can call it without coupling
   * to the queue internals.
   */
  private async extractAssistantOutput(
    sessionId: string,
    ctx: PluginInput,
  ): Promise<string> {
    const messagesResult = await ctx.client.session.messages({
      path: { id: sessionId },
      query: { directory: ctx.directory },
    });
    const messages = (messagesResult.data ?? []) as Array<{
      info: Message;
      parts: Part[];
    }>;

    const assistantTexts: string[] = [];
    for (const msg of messages) {
      if (msg.info.role !== 'assistant') continue;
      for (const part of msg.parts) {
        if (part.type === 'text' && part.text) {
          assistantTexts.push(part.text);
        }
      }
    }

    return assistantTexts.join('\n\n');
  }
}
