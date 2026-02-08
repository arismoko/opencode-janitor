import { watch, existsSync, type FSWatcher } from 'node:fs';
import { log, warn } from '../utils/logger';
import type { CommitSignal, SignalSource } from '../types';

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
export class CommitDetector {
  private lastSeenHead: string | null = null;
  private processed = new Set<string>();
  private watchers: FSWatcher[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  constructor(
    private getHead: () => Promise<string>,
    private onNewCommit: CommitCallback,
    private debounceMs: number = 1200,
    private pollIntervalSec: number = 15,
  ) {}

  /**
   * Start watching for commits.
   * Sets up fs.watch on git refs and a poll safety net.
   */
  async start(gitDir: string): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Initialize last seen HEAD
    try {
      this.lastSeenHead = (await this.getHead()).trim();
      log(`[commit-detector] initial HEAD: ${this.lastSeenHead}`);
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
        const watcher = watch(
          target,
          { recursive: true },
          () => {
            this.signal('fswatch');
          },
        );
        this.watchers.push(watcher);
        log(`[commit-detector] watching: ${target}`);
      } catch {
        warn(`[commit-detector] could not watch ${target}`);
      }
    }

    // Safety net: periodic poll
    this.pollTimer = setInterval(() => {
      this.signal('poll');
    }, this.pollIntervalSec * 1000);

    log('[commit-detector] started');
  }

  /**
   * Receive accelerator signal from tool.execute.after hook.
   * Bypasses debounce for faster response to in-session commits.
   */
  accelerate(): void {
    this.signal('tool-hook');
  }

  /**
   * Mark a SHA as already processed (e.g., on plugin restart).
   */
  markProcessed(sha: string): void {
    this.processed.add(sha);
  }

  /**
   * Process any signal with debounce.
   */
  private signal(source: SignalSource): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.verify({ source, ts: Date.now() });
    }, this.debounceMs);
  }

  /**
   * Verify HEAD and trigger callback if new commit.
   * This is the single source of truth — all signals funnel here.
   */
  private async verify(signal: CommitSignal): Promise<void> {
    try {
      const head = (await this.getHead()).trim();
      if (!head || head === this.lastSeenHead) return;

      this.lastSeenHead = head;

      if (this.processed.has(head)) {
        log(`[commit-detector] already processed: ${head}`);
        return;
      }

      this.processed.add(head);
      log(`[commit-detector] new commit: ${head} via ${signal.source}`);
      await this.onNewCommit(head, signal);
    } catch (err) {
      warn(`[commit-detector] verify failed: ${err}`);
    }
  }

  /**
   * Clean up watchers and timers.
   */
  stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.started = false;
    log('[commit-detector] stopped');
  }
}
