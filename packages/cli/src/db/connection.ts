/**
 * SQLite connection with Bun-native driver.
 */
import { Database } from 'bun:sqlite';
import { defaultDbPath, ensureParentDirs } from '../config/paths';

/**
 * Open a SQLite database at the given path (defaults to XDG state dir).
 * Applies recommended PRAGMAs for WAL mode, foreign keys, and busy timeout.
 */
export function openDatabase(path?: string): Database {
  const dbPath = path ?? defaultDbPath();
  ensureParentDirs(dbPath);

  const db = new Database(dbPath, { create: true });

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  return db;
}
