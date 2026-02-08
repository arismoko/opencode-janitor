import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteSync } from '../utils/atomic-write';
import { evictOldest, MAX_PROCESSED } from '../utils/eviction';
import { log, warn } from '../utils/logger';

const STATE_FILE = '.janitor/state.json';

interface StateData {
  version?: number;
  processedShas: string[];
  processedPrKeys?: string[];
  processedReviewerHeads?: string[];
  pausedJanitor?: boolean;
  pausedReviewer?: boolean;
}

/**
 * In-memory store for tracking processed commits.
 * Optionally persists to `.janitor/state.json` for cross-session deduplication.
 */
export class CommitStore {
  private processed = new Set<string>();
  private processedPrKeys = new Set<string>();
  private processedReviewerHeads = new Set<string>();
  private pausedJanitor = false;
  private pausedReviewer = false;
  private statePath: string;

  constructor(workspaceDir: string) {
    this.statePath = join(workspaceDir, STATE_FILE);
    this.load();
  }

  /** Mark a SHA as processed */
  add(sha: string): void {
    this.processed.add(sha);
    this.evictOld();
    this.persist();
  }

  /** Check whether a SHA has already been processed. */
  hasProcessedSha(sha: string): boolean {
    return this.processed.has(sha);
  }

  /** Get all processed SHAs */
  getProcessed(): string[] {
    return [...this.processed];
  }

  /** Mark a PR key as processed */
  addPrKey(key: string): void {
    this.processedPrKeys.add(key);
    this.evictOld();
    this.persist();
  }

  /** Check whether a PR key has already been processed. */
  hasProcessedPrKey(key: string): boolean {
    return this.processedPrKeys.has(key);
  }

  /** Mark a reviewer head SHA as processed. */
  addProcessedReviewerHead(headSha: string): void {
    this.processedReviewerHeads.add(headSha);
    this.evictOld();
    this.persist();
  }

  /** Check whether reviewer already processed this head SHA. */
  hasProcessedReviewerHead(headSha: string): boolean {
    return this.processedReviewerHeads.has(headSha);
  }

  /** Read paused flags for command controls. */
  getPaused(): { janitor: boolean; reviewer: boolean } {
    return { janitor: this.pausedJanitor, reviewer: this.pausedReviewer };
  }

  /** Persist paused flags for command controls. */
  setPaused(flags: { janitor: boolean; reviewer: boolean }): void {
    this.pausedJanitor = flags.janitor;
    this.pausedReviewer = flags.reviewer;
    this.persist();
  }

  /** Get all processed PR state keys */
  getProcessedPrKeys(): string[] {
    return [...this.processedPrKeys];
  }

  /**
   * Load state from disk.
   */
  private load(): void {
    if (!existsSync(this.statePath)) return;

    try {
      const raw = readFileSync(this.statePath, 'utf-8');
      const data: StateData = JSON.parse(raw);

      if (Array.isArray(data.processedShas)) {
        for (const sha of data.processedShas) {
          this.processed.add(sha);
        }
      }

      if (Array.isArray(data.processedPrKeys)) {
        for (const key of data.processedPrKeys) {
          this.processedPrKeys.add(key);
        }
      }

      if (Array.isArray(data.processedReviewerHeads)) {
        for (const head of data.processedReviewerHeads) {
          this.processedReviewerHeads.add(head);
        }
      }

      this.pausedJanitor = Boolean(data.pausedJanitor);
      this.pausedReviewer = Boolean(data.pausedReviewer);

      log(
        `[store] loaded ${this.processed.size} processed commits and ${this.processedPrKeys.size} processed PR keys`,
      );
    } catch {
      warn('[store] failed to load state file');
    }
  }

  /**
   * Persist state to disk.
   */
  private persist(): void {
    try {
      const dir = dirname(this.statePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data: StateData = {
        version: 2,
        processedShas: [...this.processed],
        processedPrKeys: [...this.processedPrKeys],
        processedReviewerHeads: [...this.processedReviewerHeads],
        pausedJanitor: this.pausedJanitor,
        pausedReviewer: this.pausedReviewer,
      };

      atomicWriteSync(this.statePath, JSON.stringify(data, null, 2));
    } catch {
      warn('[store] failed to persist state');
    }
  }

  /**
   * Evict old entries to prevent unbounded growth.
   * Keeps the most recent MAX_PROCESSED entries.
   */
  private evictOld(): void {
    const before = this.processed.size;
    evictOldest(this.processed, MAX_PROCESSED);
    const evicted = before - this.processed.size;
    const beforePr = this.processedPrKeys.size;
    evictOldest(this.processedPrKeys, MAX_PROCESSED);
    const evictedPr = beforePr - this.processedPrKeys.size;
    const beforeReviewerHeads = this.processedReviewerHeads.size;
    evictOldest(this.processedReviewerHeads, MAX_PROCESSED);
    const evictedReviewerHeads =
      beforeReviewerHeads - this.processedReviewerHeads.size;
    if (evicted > 0) {
      log(`[store] evicted ${evicted} old entries`);
    }
    if (evictedPr > 0) {
      log(`[store] evicted ${evictedPr} old PR entries`);
    }
    if (evictedReviewerHeads > 0) {
      log(`[store] evicted ${evictedReviewerHeads} old reviewer head entries`);
    }
  }
}
