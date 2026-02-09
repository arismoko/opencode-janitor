import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import { getErrorMessage, log, warn } from '../utils/logger';
import { notifyError } from '../utils/notifier';

/** Shared job lifecycle fields used by both orchestrator variants. */
export interface BaseJob<TContext, TResult> {
  key: string;
  context: TContext;
  deliverySessionId?: string;
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

type Executor<TContext> = (context: TContext) => Promise<string>;

/**
 * Generic review orchestrator managing the queue and lifecycle of review jobs.
 *
 * Policies:
 * - Serial execution (concurrency=1 default)
 * - Burst coalescing: keeps oldest running + latest pending
 * - Running reviews can be explicitly cancelled by user command
 * - Review execution never blocks on user root sessions
 *
 * Subclasses provide:
 * - `extractKey(context)` to derive the dedup key from enqueue context
 * - `onCompleted(job, sessionId, ctx, config)` to parse results and deliver
 * - `errorLabel(key)` for human-readable error messages
 */
export abstract class BaseOrchestrator<TContext, TResult> {
  private jobs = new Map<string, BaseJob<TContext, TResult>>();
  private sessionToKey = new Map<string, string>();
  private queue: string[] = [];
  private activeCount = 0;
  private halted = false;
  private ctx?: PluginInput;

  protected readonly tag: string;

  constructor(
    protected readonly config: JanitorConfig,
    private readonly executor: Executor<TContext>,
    tag: string,
  ) {
    this.tag = tag;
  }

  /** Derive a deduplication key from the enqueue context. */
  protected abstract extractKey(context: TContext): string;

  /**
   * Called when a review session completes. Subclasses should extract messages,
   * parse results, persist state, and deliver outputs.
   */
  protected abstract onJobCompleted(
    job: BaseJob<TContext, TResult>,
    sessionId: string,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void>;

  /** Human-readable label for error messages (e.g. "commit `abc12345`"). */
  protected abstract errorLabel(key: string): string;

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
      | 'deliverySessionId'
      | 'enqueuedAt'
      | 'startedAt'
    >
  > {
    return [...this.jobs.values()].map((job) => ({
      key: job.key,
      status: job.status,
      sessionId: job.sessionId,
      deliverySessionId: job.deliverySessionId,
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

  /** Abort all currently running sessions owned by this orchestrator. */
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
  enqueue(context: TContext, deliverySessionId?: string): void {
    if (this.halted) {
      log(`[${this.tag}] enqueue ignored while halted`);
      return;
    }

    const key = this.extractKey(context);

    // Already processing this key
    if (this.jobs.has(key)) {
      log(`[${this.tag}] already tracking: ${key}`);
      return;
    }

    const job: BaseJob<TContext, TResult> = {
      key,
      context,
      deliverySessionId,
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
        const sessionId = await this.executor(job.context);

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
        if (this.ctx && job.deliverySessionId) {
          notifyError(
            this.ctx,
            job.deliverySessionId,
            `Review failed for ${this.errorLabel(key)}`,
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
   * Delegates to subclass `onJobCompleted` for result extraction and delivery.
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
      if (!job.deliverySessionId) {
        job.deliverySessionId = await this.resolveLatestRootSessionId(ctx);
      }
      await this.onJobCompleted(job, sessionId, ctx, config);
    } catch (err) {
      job.status = 'failed';
      job.completedAt = new Date();
      job.error = getErrorMessage(err);
      warn(`[${this.tag}] result extraction failed: ${key} — ${job.error}`);

      // Surface extraction failure to the user in their originating session
      if (this.ctx && job.deliverySessionId) {
        notifyError(
          this.ctx,
          job.deliverySessionId,
          `Failed to extract review results for ${this.errorLabel(key)}`,
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
    this.jobs.delete(key);
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.processQueue();

    warn(`[${this.tag}] session failed: ${key} — ${error}`);
  }

  /**
   * Extract assistant text output from a completed review session.
   * Shared utility for subclasses to use in their `onJobCompleted`.
   */
  protected async extractAssistantOutput(
    sessionId: string,
    ctx: PluginInput,
  ): Promise<string> {
    const messagesResult = await ctx.client.session.messages({
      path: { id: sessionId },
      query: { directory: ctx.directory },
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

    return assistantTexts.join('\n\n');
  }

  private async resolveLatestRootSessionId(
    ctx: PluginInput,
  ): Promise<string | undefined> {
    try {
      const result = await ctx.client.session.list({
        query: {
          directory: ctx.directory,
        },
      });
      const sessions = ((result as { data?: unknown[] }).data ?? []) as Array<{
        id?: string;
        title?: string;
        parentID?: string;
        time?: { updated?: number };
      }>;
      const root = sessions
        .filter(
          (session) =>
            session.id &&
            !session.parentID &&
            !session.title?.startsWith('[janitor-run] ') &&
            !session.title?.startsWith('[reviewer-run] '),
        )
        .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))[0];
      return root?.id;
    } catch {
      return undefined;
    }
  }
}
