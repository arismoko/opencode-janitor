import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteSync } from '../utils/atomic-write';
import { log, warn } from '../utils/logger';

const STATE_FILE = '.janitor/active-runs.json';

export interface ActiveRun {
  /** Composite ID: `${orchestrator}:${key}` */
  id: string;
  /** Which orchestrator owns this: 'janitor' | 'reviewer' */
  orchestrator: 'janitor' | 'reviewer';
  /** The dedup key (SHA for janitor, pr context key for reviewer) */
  key: string;
  /** OpenCode session ID running the review */
  sessionId: string;
  /** Parent session ID for delivery */
  parentSessionId: string;
  /** ISO timestamp when the run started */
  startedAt: string;
  /** Number of resume attempts after crash recovery */
  resumeAttempts: number;
}

interface StoreData {
  version: 1;
  runs: ActiveRun[];
}

/**
 * File-backed journal for tracking active review sessions.
 * Enables crash recovery by persisting in-flight runs to disk.
 */
export class ReviewRunStore {
  private runs: ActiveRun[] = [];
  private statePath: string;

  constructor(workspaceDir: string) {
    this.statePath = join(workspaceDir, STATE_FILE);
    this.load();
  }

  /** Add a run with resumeAttempts=0 and persist */
  track(run: Omit<ActiveRun, 'resumeAttempts'>): void {
    this.runs = this.runs.filter((r) => r.id !== run.id);
    this.runs.push({ ...run, resumeAttempts: 0 });
    this.persist();
  }

  /** Remove a run by id and persist */
  complete(id: string): void {
    this.runs = this.runs.filter((r) => r.id !== id);
    this.persist();
  }

  /** Bump resumeAttempts for a run and persist */
  incrementResumeAttempts(id: string): void {
    const run = this.runs.find((r) => r.id === id);
    if (run) {
      run.resumeAttempts++;
      this.persist();
    }
  }

  /** Return all active runs */
  getActive(): ActiveRun[] {
    return [...this.runs];
  }

  /** Remove runs older than maxAgeMs based on startedAt, persist only if pruned */
  pruneStale(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;
    const before = this.runs.length;
    this.runs = this.runs.filter(
      (r) => new Date(r.startedAt).getTime() > cutoff,
    );
    if (this.runs.length < before) {
      log(`[run-store] pruned ${before - this.runs.length} stale runs`);
      this.persist();
    }
  }

  /**
   * Load state from disk.
   */
  private load(): void {
    if (!existsSync(this.statePath)) return;

    try {
      const raw = readFileSync(this.statePath, 'utf-8');
      const data: StoreData = JSON.parse(raw);

      if (data.version !== 1) {
        warn('[run-store] unknown version, ignoring state file');
        return;
      }

      if (Array.isArray(data.runs)) {
        this.runs = data.runs;
      }

      log(`[run-store] loaded ${this.runs.length} active runs`);
    } catch {
      warn('[run-store] failed to load state file');
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

      const data: StoreData = {
        version: 1,
        runs: this.runs,
      };

      atomicWriteSync(this.statePath, JSON.stringify(data, null, 2));
    } catch {
      warn('[run-store] failed to persist state');
    }
  }
}
