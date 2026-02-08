import { evictOldest, MAX_PROCESSED } from '../utils/eviction';
import { log, warn } from '../utils/logger';

/**
 * Generic signal detector base class.
 *
 * Owns the debounced verify-and-callback pipeline with:
 * - Exactly-once processing per key (via `processed` set)
 * - Re-entrancy guard (`inflight`) to prevent duplicate callbacks
 * - Post-callback state commit — transient failures retry instead of
 *   permanently poisoning state
 *
 * Subclasses provide:
 * - `getCurrentKey()` — resolve the current state key (e.g., HEAD sha, PR key)
 * - `onDetected(key, signal)` — callback for new detections (set via constructor)
 * - `start()` — detector-specific startup logic (fs.watch, poll timers, etc.)
 */
export abstract class SignalDetector<
  TSignal extends { source: string; ts: number },
> {
  protected lastSeenKey: string | null = null;
  protected processed = new Set<string>();
  protected pollTimer: ReturnType<typeof setInterval> | null = null;
  protected debounceTimer: ReturnType<typeof setTimeout> | null = null;
  protected inflight: string | null = null;
  protected started = false;

  constructor(
    protected readonly label: string,
    protected readonly onDetected: (
      key: string,
      signal: TSignal,
    ) => Promise<void>,
    protected readonly debounceMs: number = 1200,
    protected readonly pollIntervalSec: number = 15,
  ) {}

  /**
   * Resolve the current state key.
   * Return `null` to indicate no actionable state (e.g., no open PR).
   */
  protected abstract getCurrentKey(): Promise<string | null>;

  /**
   * Receive accelerator signal from tool.execute.after hook.
   * Routes through the standard debounced signal pipeline — does NOT
   * bypass debounce, but provides faster detection than the poll
   * fallback by triggering an immediate debounced check.
   */
  accelerate(): void {
    this.signal({ source: 'tool-hook', ts: Date.now() } as TSignal);
  }

  /**
   * Mark a key as already processed (e.g., on plugin restart).
   */
  markProcessed(key: string): void {
    this.processed.add(key);
    this.evictProcessed();
  }

  /**
   * Process any signal with debounce.
   */
  protected signal(signal: TSignal): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.verify(signal);
    }, this.debounceMs);
  }

  /**
   * Verify current key and trigger callback if new state.
   * This is the single source of truth — all signals funnel here.
   *
   * State transitions (`lastSeenKey`, `processed`) are committed ONLY
   * after the callback succeeds. If `onDetected` throws (transient git/gh
   * failure), the same key will be retried on the next poll instead of
   * being silently swallowed.
   *
   * Re-entrancy guard (`inflight`) prevents duplicate callbacks when a
   * slow `onDetected` overlaps with the next poll/tool-hook signal.
   */
  private async verify(signal: TSignal): Promise<void> {
    try {
      const key = await this.getCurrentKey();
      if (!key) return;

      if (key === this.lastSeenKey) return;

      if (this.processed.has(key)) {
        // Advance lastSeenKey to suppress future redundant logs,
        // but don't re-trigger the callback.
        this.lastSeenKey = key;
        log(`[${this.label}] already processed: ${key}`);
        return;
      }

      // Re-entrancy guard: if onDetected is still running for this key
      // (e.g. slow context build + another poll fires), skip.
      if (key === this.inflight) return;
      this.inflight = key;

      log(`[${this.label}] new state: ${key} via ${signal.source}`);
      try {
        await this.onDetected(key, signal);
      } finally {
        this.inflight = null;
      }

      // Only commit state after successful callback — a transient failure
      // (network, git, gh CLI) leaves lastSeenKey unchanged so the next
      // poll retries the same key.
      this.lastSeenKey = key;
      this.processed.add(key);
      this.evictProcessed();
    } catch (err) {
      warn(`[${this.label}] verify failed: ${err}`);
    }
  }

  /** Evict oldest entries when the processed set exceeds the cap. */
  private evictProcessed(): void {
    evictOldest(this.processed, MAX_PROCESSED);
  }

  /**
   * Clean up timers. Subclasses should call `super.stop()` after their
   * own cleanup (e.g., closing fs.watchers).
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.started = false;
    log(`[${this.label}] stopped`);
  }
}
