import type { Database } from 'bun:sqlite';
import { makeId } from '../../utils/ids';
import { nowMs } from '../../utils/time';
import type { RepoRow } from '../models';

export interface NewRepo {
  path: string;
  gitDir: string;
  defaultBranch: string;
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
