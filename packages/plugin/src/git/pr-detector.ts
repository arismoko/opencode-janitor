import { log } from '../utils/logger';
import { SignalDetector } from './signal-detector';

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
export class PrDetector extends SignalDetector<PrSignal> {
  constructor(
    getCurrentKey: () => Promise<string | null>,
    onNewState: PrCallback,
    debounceMs: number = 1200,
    pollIntervalSec: number = 20,
  ) {
    super('pr-detector', onNewState, debounceMs, pollIntervalSec);
    this.getCurrentKeyFn = getCurrentKey;
  }

  private readonly getCurrentKeyFn: () => Promise<string | null>;

  protected async getCurrentKey(): Promise<string | null> {
    return this.getCurrentKeyFn();
  }

  /**
   * Start polling for PR state changes.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Kick off initial check
    this.signal({ source: 'poll', ts: Date.now() });

    // Safety net: periodic poll
    this.pollTimer = setInterval(() => {
      this.signal({ source: 'poll', ts: Date.now() });
    }, this.pollIntervalSec * 1000);

    log('[pr-detector] started');
  }
}
