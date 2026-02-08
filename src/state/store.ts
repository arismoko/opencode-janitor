import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { evictOldest, MAX_PROCESSED } from '../utils/eviction';
import { log, warn } from '../utils/logger';

const STATE_FILE = '.janitor/state.json';

interface StateData {
  processedShas: string[];
  lastHead?: string;
}

/**
 * In-memory store for tracking processed commits.
 * Optionally persists to `.janitor/state.json` for cross-session deduplication.
 */
export class CommitStore {
  private processed = new Set<string>();
  private lastHead: string | null = null;
  private statePath: string;

  constructor(workspaceDir: string) {
    this.statePath = join(workspaceDir, STATE_FILE);
    this.load();
  }

  /** Check if a SHA has been processed */
  has(sha: string): boolean {
    return this.processed.has(sha);
  }

  /** Mark a SHA as processed */
  add(sha: string): void {
    this.processed.add(sha);
    this.evictOld();
    this.persist();
  }

  /** Get the last known HEAD */
  getLastHead(): string | null {
    return this.lastHead;
  }

  /** Update the last known HEAD */
  setLastHead(sha: string): void {
    this.lastHead = sha;
    this.persist();
  }

  /** Get all processed SHAs */
  getProcessed(): string[] {
    return [...this.processed];
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

      if (data.lastHead) {
        this.lastHead = data.lastHead;
      }

      log(`[store] loaded ${this.processed.size} processed commits`);
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
        processedShas: [...this.processed],
        lastHead: this.lastHead ?? undefined,
      };

      writeFileSync(this.statePath, JSON.stringify(data, null, 2), 'utf-8');
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
    if (evicted > 0) {
      log(`[store] evicted ${evicted} old entries`);
    }
  }
}
