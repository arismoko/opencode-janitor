import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { warn } from '../utils/logger';
import { isExpired } from './matcher';
import { SuppressionsFileSchema } from './schema';
import type { Suppression, SuppressionsFile } from './types';

const MAX_SUPPRESSIONS = 200;

/** Manages `.janitor/suppressions.json` persistence */
export class SuppressionStore {
  private filePath: string;
  private readonly maxEntries: number;
  private suppressions: Suppression[] = [];

  constructor(workspaceDir: string, opts?: { maxEntries?: number }) {
    this.filePath = join(workspaceDir, '.janitor', 'suppressions.json');
    this.maxEntries = opts?.maxEntries ?? MAX_SUPPRESSIONS;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.suppressions = [];
      return;
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const result = SuppressionsFileSchema.safeParse(parsed);

      if (!result.success) {
        warn('Invalid suppressions file, starting fresh', {
          path: this.filePath,
        });
        this.suppressions = [];
        return;
      }

      this.suppressions = result.data.suppressions;
    } catch (err) {
      warn('Failed to read suppressions file', {
        path: this.filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      this.suppressions = [];
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const data: SuppressionsFile = {
      version: 1,
      suppressions: this.suppressions,
    };

    writeFileSync(this.filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }

  /** Returns non-expired entries */
  getActive(): Suppression[] {
    return this.suppressions.filter((s) => !isExpired(s));
  }

  /** Returns all entries (including expired) */
  getAll(): Suppression[] {
    return [...this.suppressions];
  }

  /** Add a suppression, evicting oldest-lastSeenAt if at capacity */
  add(suppression: Suppression): void {
    // Remove existing entry with same exactKey to avoid duplicates
    this.suppressions = this.suppressions.filter(
      (s) => s.exactKey !== suppression.exactKey,
    );

    // Evict oldest-lastSeenAt entries if at capacity
    while (this.suppressions.length >= this.maxEntries) {
      let oldestIdx = 0;
      let oldestTime = new Date(this.suppressions[0].lastSeenAt).getTime();

      for (let i = 1; i < this.suppressions.length; i++) {
        const t = new Date(this.suppressions[i].lastSeenAt).getTime();
        if (t < oldestTime) {
          oldestTime = t;
          oldestIdx = i;
        }
      }

      this.suppressions.splice(oldestIdx, 1);
    }

    this.suppressions.push(suppression);
    this.save();
  }

  /** Update lastSeenAt for multiple suppressions, saving once. */
  touchMany(exactKeys: string[]): void {
    const keySet = new Set(exactKeys);
    const now = new Date().toISOString();
    let changed = false;

    for (const s of this.suppressions) {
      if (keySet.has(s.exactKey)) {
        s.lastSeenAt = now;
        changed = true;
      }
    }

    if (changed) {
      this.save();
    }
  }

  /** Remove a suppression by exactKey */
  remove(exactKey: string): void {
    this.suppressions = this.suppressions.filter(
      (s) => s.exactKey !== exactKey,
    );
    this.save();
  }

  /** Remove expired entries */
  gc(): void {
    const before = this.suppressions.length;
    this.suppressions = this.suppressions.filter((s) => !isExpired(s));

    if (this.suppressions.length !== before) {
      this.save();
    }
  }
}
