/**
 * Trigger and signal types for review detection.
 */

// ---------------------------------------------------------------------------
// Signal source
// ---------------------------------------------------------------------------

/** Signal source for commit detection */
export type SignalSource = 'fswatch' | 'tool-hook' | 'poll';

/** A commit detection signal */
export interface CommitSignal {
  source: SignalSource;
  ts: number;
}

// ---------------------------------------------------------------------------
// Trigger kind
// ---------------------------------------------------------------------------

export type TriggerKind = 'commit' | 'pr' | 'manual';
