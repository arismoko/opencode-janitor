import { evictOldest, MAX_PROCESSED } from '../utils/eviction';
import { log, warn } from '../utils/logger';

/** Signal source for PR detection */
export type PrSignalSource = 'tool-hook' | 'poll';

/** A PR detection signal */
export interface PrSignal {
  source: PrSignalSource;
  ts: number;
}

export type PrCallback = (key: string, signal: PrSignal) => Promise<void>;

/**
 * Hybrid PR detector using poll + tool-hook acceleration.
 *
 * Signals are debounced and verified against the current PR state key
 * before triggering the callback. Ensures exactly-once processing
 * per state key.
 */
export class PrDetector {
  private lastSeenKey: string | null = null;
  private processed = new Set<string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: string | null = null;
  private started = false;

  constructor(
    private getCurrentKey: () => Promise<string | null>,
    private onNewState: PrCallback,
    private debounceMs: number = 1200,
    private pollIntervalSec: number = 20,
  ) {}

  /**
   * Start polling for PR state changes.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Kick off initial check
    this.signal('poll');

    // Safety net: periodic poll
    this.pollTimer = setInterval(() => {
      this.signal('poll');
    }, this.pollIntervalSec * 1000);

    log('[pr-detector] started');
  }

  /**
   * Receive accelerator signal from tool.execute.after hook.
   * Routes through the standard debounced signal pipeline — does NOT
   * bypass debounce, but provides faster detection than the poll
   * fallback by triggering an immediate debounced check.
   */
  accelerate(): void {
    this.signal('tool-hook');
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
  private signal(source: PrSignalSource): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.verify({ source, ts: Date.now() });
    }, this.debounceMs);
  }

  /**
   * Verify current PR key and trigger callback if new state.
   * This is the single source of truth — all signals funnel here.
   *
   * State transitions (`lastSeenKey`, `processed`) are committed ONLY
   * after the callback succeeds. If `onNewState` throws (transient git/gh
   * failure), the same key will be retried on the next poll instead of
   * being silently swallowed.
   *
   * Re-entrancy guard (`inflight`) prevents duplicate callbacks when a
   * slow `onNewState` overlaps with the next poll/tool-hook signal.
   */
  private async verify(signal: PrSignal): Promise<void> {
    try {
      const key = await this.getCurrentKey();
      if (!key) return;

      if (key === this.lastSeenKey) return;

      if (this.processed.has(key)) {
        // Advance lastSeenKey to suppress future redundant logs,
        // but don't re-trigger the callback.
        this.lastSeenKey = key;
        log(`[pr-detector] already processed: ${key}`);
        return;
      }

      // Re-entrancy guard: if onNewState is still running for this key
      // (e.g. slow PR context build + another poll fires), skip.
      if (key === this.inflight) return;
      this.inflight = key;

      log(`[pr-detector] new state: ${key} via ${signal.source}`);
      try {
        await this.onNewState(key, signal);
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
      warn(`[pr-detector] verify failed: ${err}`);
    }
  }

  /** Evict oldest entries when the processed set exceeds the cap. */
  private evictProcessed(): void {
    evictOldest(this.processed, MAX_PROCESSED);
  }

  /**
   * Clean up timers.
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
    log('[pr-detector] stopped');
  }
}
