import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { warn } from '../utils/logger';
import { HistoryFileSchema } from './schema';
import type { FindingLedgerEntry, HistoryFile, ReviewRecord } from './types';

const DEFAULT_MAX_REVIEWS = 50;
const DEFAULT_MAX_BYTES = 2_097_152; // 2 MB

export class HistoryStore {
  private readonly filePath: string;
  private readonly maxReviews: number;
  private readonly maxBytes: number;
  private reviews: ReviewRecord[] = [];
  private ledger: FindingLedgerEntry[] = [];

  constructor(
    workspaceDir: string,
    opts?: { maxReviews?: number; maxBytes?: number },
  ) {
    this.filePath = join(workspaceDir, '.janitor', 'history.json');
    this.maxReviews = opts?.maxReviews ?? DEFAULT_MAX_REVIEWS;
    this.maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
    this.load();
  }

  getReviews(): ReviewRecord[] {
    return this.reviews;
  }

  getLedger(): FindingLedgerEntry[] {
    return this.ledger;
  }

  addReview(record: ReviewRecord): void {
    this.reviews.push(record);
    this.save();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.reviews = [];
      this.ledger = [];
      return;
    }

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const result = HistoryFileSchema.safeParse(parsed);

      if (!result.success) {
        warn('Invalid history file, starting fresh', {
          path: this.filePath,
        });
        this.reviews = [];
        this.ledger = [];
        return;
      }

      this.reviews = result.data.reviews;
      this.rebuildLedger();
    } catch {
      warn('Failed to read history file, starting fresh', {
        path: this.filePath,
      });
      this.reviews = [];
      this.ledger = [];
    }
  }

  private save(): void {
    // Enforce maxReviews limit — evict oldest first
    while (this.reviews.length > this.maxReviews) {
      this.reviews.shift();
    }

    // Enforce maxBytes limit — evict oldest until under budget
    let data = this.buildFileData();
    let serialized = JSON.stringify(data, null, 2);

    while (
      this.reviews.length > 1 &&
      new TextEncoder().encode(serialized).length > this.maxBytes
    ) {
      this.reviews.shift();
      data = this.buildFileData();
      serialized = JSON.stringify(data, null, 2);
    }

    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.filePath, serialized, 'utf-8');
    this.rebuildLedger();
  }

  private buildFileData(): HistoryFile {
    return {
      version: 1,
      reviews: this.reviews,
    };
  }

  private rebuildLedger(): void {
    const entries = new Map<string, FindingLedgerEntry>();

    for (const review of this.reviews) {
      const seenKeys = new Set<string>();

      for (const f of review.findings) {
        seenKeys.add(f.exactKey);

        const existing = entries.get(f.exactKey);
        if (existing) {
          existing.lastSeenSha = review.sha;
          existing.occurrences += 1;
          existing.consecutiveRuns += 1;
          existing.state = 'active';
        } else {
          entries.set(f.exactKey, {
            exactKey: f.exactKey,
            scopedKey: f.scopedKey,
            category: f.category,
            location: f.location,
            firstSeenSha: review.sha,
            lastSeenSha: review.sha,
            occurrences: 1,
            consecutiveRuns: 1,
            state: 'active',
          });
        }
      }

      // Mark unseen active entries as resolved after each review
      for (const entry of entries.values()) {
        if (entry.state === 'active' && !seenKeys.has(entry.exactKey)) {
          entry.state = 'resolved';
          entry.consecutiveRuns = 0;
        }
      }
    }

    this.ledger = Array.from(entries.values());
  }
}
