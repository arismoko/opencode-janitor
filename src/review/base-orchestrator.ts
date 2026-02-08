import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import { getErrorMessage, log, warn } from '../utils/logger';
import { notifyError } from '../utils/notifier';

/**
 * Thrown by the executor when no root session is available to host the review.
 * The orchestrator catches this specifically and keeps the job pending for retry
 * rather than marking it as permanently failed.
 */
export class NoSessionError extends Error {
  constructor() {
    super('No root session available');
    this.name = 'NoSessionError';
  }
}

/** Shared job lifecycle fields used by both orchestrator variants. */
export interface BaseJob<TContext, TResult> {
  key: string;
  context: TContext;
  parentSessionId?: string;
  sessionId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  enqueuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: TResult;
  error?: string;
}

type Executor<TContext> = (
  context: TContext,
  parentSessionId: string,
) => Promise<string>;

/**
 * Generic review orchestrator managing the queue and lifecycle of review jobs.
 *
 * Policies:
 * - Serial execution (concurrency=1 default)
 * - Burst coalescing: keeps oldest running + latest pending
 * - Running reviews are never cancelled
 * - Jobs waiting for a session are re-queued, not dropped
 *
 * Subclasses provide:
 * - `extractKey(context)` to derive the dedup key from enqueue context
 * - `onCompleted(job, sessionId, ctx, config)` to parse results and deliver
 * - `errorLabel(key)` for human-readable error messages
 */
/** Callback fired when a review session starts running. */
export type OnRunStarted = (info: {
  key: string;
  sessionId: string;
  parentSessionId: string;
}) => void;

/** Callback fired when a review session reaches a terminal state. */
export type OnRunTerminal = (key: string) => void;

export abstract class BaseOrchestrator<TContext, TResult> {
  private jobs = new Map<string, BaseJob<TContext, TResult>>();
  private sessionToKey = new Map<string, string>();
  private queue: string[] = [];
  private activeCount = 0;
  private latestSessionId?: string;
  private ctx?: PluginInput;
  private onRunStartedCb?: OnRunStarted;
  private onRunTerminalCb?: OnRunTerminal;

  protected readonly tag: string;

  constructor(
    protected readonly config: JanitorConfig,
    private readonly executor: Executor<TContext>,
    tag: string,
  ) {
    this.tag = tag;
  }

  /** Register a callback fired when a review session starts. */
  onRunStarted(cb: OnRunStarted): void {
    this.onRunStartedCb = cb;
  }

  /** Register a callback fired when a review session completes or fails. */
  onRunTerminal(cb: OnRunTerminal): void {
    this.onRunTerminalCb = cb;
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

  /**
   * Check whether a session ID belongs to a review session owned by this
   * orchestrator. Used to prevent child review sessions from being promoted
   * to latestSessionId, which would cause future reviews to nest incorrectly.
   */
  isOwnSession(sessionId: string): boolean {
    return this.sessionToKey.has(sessionId);
  }

  /** Whether a root session has been assigned for enqueue backfilling. */
  hasRootSession(): boolean {
    return Boolean(this.latestSessionId);
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
    for (const key of this.queue) {
      const job = this.jobs.get(key);
      if (job && job.status === 'pending' && !job.parentSessionId) {
        job.parentSessionId = sessionId;
      }
    }

    log(`[${this.tag}] root session available, draining queue`);
    this.processQueue();
  }

  /**
   * Enqueue a context for review.
   * Applies burst coalescing if dropIntermediate is enabled.
   */
  enqueue(context: TContext): void {
    const key = this.extractKey(context);

    // Already processing this key
    if (this.jobs.has(key)) {
      log(`[${this.tag}] already tracking: ${key}`);
      return;
    }

    const job: BaseJob<TContext, TResult> = {
      key,
      context,
      parentSessionId: this.latestSessionId,
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

      // Each job targets the session that was active when it was enqueued.
      // If no session was available at enqueue time, NoSessionError re-queues it.
      const targetSession = job.parentSessionId;

      try {
        if (!targetSession) {
          throw new NoSessionError();
        }
        const sessionId = await this.executor(job.context, targetSession);
        job.sessionId = sessionId;
        this.sessionToKey.set(sessionId, key);
        this.onRunStartedCb?.({
          key,
          sessionId,
          parentSessionId: targetSession,
        });
        log(`[${this.tag}] review started: ${key} → ${sessionId}`);
      } catch (err) {
        this.activeCount--;

        if (err instanceof NoSessionError) {
          // No session yet — put the job back at the front of the queue
          // so it's retried when sessionAvailable() is called.
          job.status = 'pending';
          job.startedAt = undefined;
          this.queue.unshift(key);
          log(`[${this.tag}] no session, re-queued: ${key}`);
          return; // Don't process more — we'll retry when a session appears
        }

        job.status = 'failed';
        job.error = getErrorMessage(err);
        job.completedAt = new Date();
        this.jobs.delete(key);
        this.onRunTerminalCb?.(key);
        warn(`[${this.tag}] review failed to start: ${key} — ${job.error}`);

        // Surface the error to the user in their originating session
        if (this.ctx && targetSession) {
          notifyError(
            this.ctx,
            targetSession,
            `Review failed for ${this.errorLabel(key)}`,
            err,
          ).catch(() => {}); // fire-and-forget
        }

        this.processQueue();
      }
    }
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
      await this.onJobCompleted(job, sessionId, ctx, config);
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
          `Failed to extract review results for ${this.errorLabel(key)}`,
          err,
        ).catch(() => {}); // fire-and-forget
      }
    } finally {
      this.sessionToKey.delete(sessionId);
      this.activeCount--;
      // Prune terminal jobs to prevent unbounded growth
      this.jobs.delete(key);
      this.onRunTerminalCb?.(key);
      this.processQueue();
    }
  }

  /**
   * Re-attach an already running session to this orchestrator after restart.
   * Returns false if the key is already tracked or parent session is missing.
   */
  registerRecoveredRun(
    context: TContext,
    parentSessionId: string,
    sessionId: string,
  ): boolean {
    const key = this.extractKey(context);
    if (
      !parentSessionId ||
      this.jobs.has(key) ||
      this.sessionToKey.has(sessionId)
    ) {
      return false;
    }

    const now = new Date();
    const job: BaseJob<TContext, TResult> = {
      key,
      context,
      parentSessionId,
      sessionId,
      status: 'running',
      enqueuedAt: now,
      startedAt: now,
    };

    this.jobs.set(key, job);
    this.sessionToKey.set(sessionId, key);
    this.activeCount++;
    log(`[${this.tag}] reattached recovered run: ${key} → ${sessionId}`);
    return true;
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
}
