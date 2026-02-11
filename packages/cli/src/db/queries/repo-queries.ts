import type { Database } from 'bun:sqlite';
import type { ReviewJobPayload } from '../../runtime/review-job-payload';
import { makeId } from '../../utils/ids';
import { nowMs } from '../../utils/time';
import type { RepoRow } from '../models';

export interface NewRepo {
  path: string;
  gitDir: string;
  defaultBranch: string;
}

export interface TriggerEnqueueInput {
  repoId: string;
  kind: 'commit' | 'pr' | 'manual';
  source: 'fswatch' | 'poll' | 'tool-hook' | 'cli' | 'recovery';
  subjectKey: string;
  payload: ReviewJobPayload;
  maxAttempts?: number;
}

export function addRepo(db: Database, repo: NewRepo): RepoRow {
  const now = nowMs();
  const id = makeId('repo');

  db.query(
    `
      INSERT INTO repos (
        id, path, git_dir, default_branch, enabled, paused, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, 0, ?, ?)
    `,
  ).run(id, repo.path, repo.gitDir, repo.defaultBranch, now, now);

  return db.query('SELECT * FROM repos WHERE id = ?').get(id) as RepoRow;
}

export function removeRepoByIdOrPath(
  db: Database,
  idOrPath: string,
): RepoRow | null {
  const row = db
    .query('SELECT * FROM repos WHERE id = ? OR path = ?')
    .get(idOrPath, idOrPath) as RepoRow | null;

  if (!row) {
    return null;
  }

  db.query('DELETE FROM repos WHERE id = ?').run(row.id);
  return row;
}

export function listRepos(db: Database): RepoRow[] {
  return db
    .query('SELECT * FROM repos ORDER BY created_at DESC')
    .all() as RepoRow[];
}

export function updateRepoSignals(
  db: Database,
  repoId: string,
  updates: { lastHeadSha?: string | null; lastPrKey?: string | null },
): void {
  const now = nowMs();
  db.query(
    `
      UPDATE repos
      SET
        last_head_sha = COALESCE(?, last_head_sha),
        last_pr_key = COALESCE(?, last_pr_key),
        updated_at = ?
      WHERE id = ?
    `,
  ).run(updates.lastHeadSha ?? null, updates.lastPrKey ?? null, now, repoId);
}

export function enqueueTriggerAndJob(
  db: Database,
  input: TriggerEnqueueInput,
): boolean {
  const now = nowMs();
  const dedupeKey = `${input.repoId}:${input.kind}:${input.subjectKey}`;
  const triggerID = makeId('trg');
  const jobID = makeId('job');
  const maxAttempts = input.maxAttempts ?? 3;

  return db.transaction(() => {
    const triggerInsert = db
      .query(
        `
        INSERT OR IGNORE INTO review_triggers (
          id, repo_id, kind, source, subject_key, dedupe_key, payload_json, detected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        triggerID,
        input.repoId,
        input.kind,
        input.source,
        input.subjectKey,
        dedupeKey,
        JSON.stringify(input.payload),
        now,
      ) as { changes?: number };

    if (!triggerInsert.changes) {
      return false;
    }

    db.query(
      `
        INSERT OR IGNORE INTO review_jobs (
          id, repo_id, trigger_id, dedupe_key, status, priority,
          attempt, max_attempts, cancel_requested, queued_at, next_attempt_at
        ) VALUES (?, ?, ?, ?, 'queued', 100, 0, ?, 0, ?, ?)
      `,
    ).run(jobID, input.repoId, triggerID, dedupeKey, maxAttempts, now, now);

    return true;
  })();
}

export function findRepoByIdOrPath(
  db: Database,
  idOrPath: string,
): RepoRow | null {
  return (
    (db
      .query('SELECT * FROM repos WHERE id = ? OR path = ?')
      .get(idOrPath, idOrPath) as RepoRow | null) ?? null
  );
}
