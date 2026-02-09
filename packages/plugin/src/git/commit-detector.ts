import { existsSync, type FSWatcher, watch } from 'node:fs';
import type { CommitSignal } from '../types';
import { log, warn } from '../utils/logger';
import { SignalDetector } from './signal-detector';

export type CommitCallback = (
  sha: string,
  signal: CommitSignal,
) => Promise<void>;

/**
 * Hybrid commit detector using fs.watch + poll safety net.
 *
 * Signals are debounced and verified against HEAD before
 * triggering the callback. Ensures exactly-once processing
 * per commit hash.
 */
export class CommitDetector extends SignalDetector<CommitSignal> {
  private watchers: FSWatcher[] = [];

  constructor(
    private readonly getHead: () => Promise<string>,
    onNewCommit: CommitCallback,
    debounceMs: number = 1200,
    pollIntervalSec: number = 15,
  ) {
    super(
      'commit-detector',
      (key, sig) => onNewCommit(key, sig),
      debounceMs,
      pollIntervalSec,
    );
  }

  protected async getCurrentKey(): Promise<string | null> {
    const head = (await this.getHead()).trim();
    return head || null;
  }

  /**
   * Start watching for commits.
   * Sets up fs.watch on git refs and a poll safety net.
   */
  async start(gitDir: string): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Initialize last seen HEAD
    try {
      this.lastSeenKey = (await this.getHead()).trim();
      log(`[commit-detector] initial HEAD: ${this.lastSeenKey}`);
    } catch {
      warn('[commit-detector] could not read initial HEAD');
    }

    // Primary: fs.watch on git refs
    const targets = [`${gitDir}/HEAD`, `${gitDir}/refs/heads`];
    for (const target of targets) {
      if (!existsSync(target)) {
        log(`[commit-detector] target does not exist: ${target}`);
        continue;
      }
      try {
        const watcher = watch(target, { recursive: true }, () => {
          this.signal({ source: 'fswatch', ts: Date.now() });
        });
        this.watchers.push(watcher);
        log(`[commit-detector] watching: ${target}`);
      } catch {
        warn(`[commit-detector] could not watch ${target}`);
      }
    }

    // Safety net: periodic poll
    this.pollTimer = setInterval(() => {
      this.signal({ source: 'poll', ts: Date.now() });
    }, this.pollIntervalSec * 1000);

    log('[commit-detector] started');
  }

  /**
   * Clean up watchers and timers.
   */
  override stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    super.stop();
  }
}
