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
  processedHunterHeads?: string[];
  pausedJanitor?: boolean;
  pausedHunter?: boolean;
}

/**
 * Runtime state store for tracking processed reviews, PR keys, and agent control flags.
 * Optionally persists to `.janitor/state.json` for cross-session deduplication.
 */
export class RuntimeStateStore {
  private processed = new Set<string>();
  private processedPrKeys = new Set<string>();
  private processedHunterHeads = new Set<string>();
  private pausedJanitor = false;
  private pausedHunter = false;
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

  /** Mark a hunter head SHA as processed. */
  addProcessedHunterHead(headSha: string): void {
    this.processedHunterHeads.add(headSha);
    this.evictOld();
    this.persist();
  }

  /** Check whether hunter already processed this head SHA. */
  hasProcessedHunterHead(headSha: string): boolean {
    return this.processedHunterHeads.has(headSha);
  }

  /** Read paused flags for command controls. */
  getPaused(): { janitor: boolean; hunter: boolean } {
    return { janitor: this.pausedJanitor, hunter: this.pausedHunter };
  }

  /** Persist paused flags for command controls. */
  setPaused(flags: { janitor: boolean; hunter: boolean }): void {
    this.pausedJanitor = flags.janitor;
    this.pausedHunter = flags.hunter;
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

      if (Array.isArray(data.processedHunterHeads)) {
        for (const head of data.processedHunterHeads) {
          this.processedHunterHeads.add(head);
        }
      }

      this.pausedJanitor = Boolean(data.pausedJanitor);
      this.pausedHunter = Boolean(data.pausedHunter);

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
        processedHunterHeads: [...this.processedHunterHeads],
        pausedJanitor: this.pausedJanitor,
        pausedHunter: this.pausedHunter,
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
    const beforeHunterHeads = this.processedHunterHeads.size;
    evictOldest(this.processedHunterHeads, MAX_PROCESSED);
    const evictedHunterHeads =
      beforeHunterHeads - this.processedHunterHeads.size;
    if (evicted > 0) {
      log(`[store] evicted ${evicted} old entries`);
    }
    if (evictedPr > 0) {
      log(`[store] evicted ${evictedPr} old PR entries`);
    }
    if (evictedHunterHeads > 0) {
      log(`[store] evicted ${evictedHunterHeads} old hunter head entries`);
    }
  }
}
