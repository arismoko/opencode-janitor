import type { Database } from 'bun:sqlite';
import { nowMs } from '../../utils/time';

export interface DetectorRepoView {
  id: string;
  path: string;
  last_head_sha: string | null;
  last_pr_key: string | null;
  next_commit_check_at: number;
  next_pr_check_at: number;
  idle_streak: number;
  last_pr_checked_at: number | null;
}

const DETECTOR_REPO_SELECT = `SELECT id, path, last_head_sha, last_pr_key,
              next_commit_check_at, next_pr_check_at,
              idle_streak, last_pr_checked_at
       FROM repos`;

function listReposWithCheck(
  db: Database,
  columnName: 'next_commit_check_at' | 'next_pr_check_at',
  now: number,
): DetectorRepoView[] {
  return db
    .query(
      `${DETECTOR_REPO_SELECT}
       WHERE enabled = 1 AND paused = 0 AND ${columnName} <= ?
       ORDER BY ${columnName} ASC`,
    )
    .all(now) as DetectorRepoView[];
}

export function listReposDueForCommitCheck(
  db: Database,
  now: number,
): DetectorRepoView[] {
  return listReposWithCheck(db, 'next_commit_check_at', now);
}

export function listReposDueForPrCheck(
  db: Database,
  now: number,
): DetectorRepoView[] {
  return listReposWithCheck(db, 'next_pr_check_at', now);
}

export function updateProbeState(
  db: Database,
  repoId: string,
  updates: {
    nextCommitCheckAt?: number;
    nextPrCheckAt?: number;
    idleStreak?: number;
    lastPrCheckedAt?: number;
    lastHeadSha?: string;
    lastPrKey?: string | null;
  },
): void {
  const setClauses: string[] = ['updated_at = ?'];
  const params: (string | number | null)[] = [nowMs()];

  if (updates.nextCommitCheckAt !== undefined) {
    setClauses.push('next_commit_check_at = ?');
    params.push(updates.nextCommitCheckAt);
  }
  if (updates.nextPrCheckAt !== undefined) {
    setClauses.push('next_pr_check_at = ?');
    params.push(updates.nextPrCheckAt);
  }
  if (updates.idleStreak !== undefined) {
    setClauses.push('idle_streak = ?');
    params.push(updates.idleStreak);
  }
  if (updates.lastPrCheckedAt !== undefined) {
    setClauses.push('last_pr_checked_at = ?');
    params.push(updates.lastPrCheckedAt);
  }
  if (updates.lastHeadSha !== undefined) {
    setClauses.push('last_head_sha = ?');
    params.push(updates.lastHeadSha);
  }
  if (updates.lastPrKey !== undefined) {
    setClauses.push('last_pr_key = ?');
    params.push(updates.lastPrKey);
  }

  params.push(repoId);
  db.query(`UPDATE repos SET ${setClauses.join(', ')} WHERE id = ?`).run(
    ...params,
  );
}
