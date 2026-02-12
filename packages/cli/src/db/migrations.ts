/**
 * Schema initialisation for the review SQLite database.
 *
 * All tables use CREATE IF NOT EXISTS — safe to call on every startup.
 * No versioned migration chain: this is a greenfield schema with zero
 * existing users to migrate.
 */
import type { Database } from 'bun:sqlite';
import { AGENT_SQL_LIST, SEVERITY_SQL_LIST } from './enum-literals';

const LEGACY_TABLES = ['review_triggers', 'review_jobs', 'agent_runs'] as const;

const CANONICAL_TABLES = [
  'event_journal',
  'findings',
  'review_runs',
  'trigger_events',
  'trigger_states',
  'repos',
  'daemon_meta',
] as const;

function tableExists(db: Database, table: string): boolean {
  const row = db
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(table) as { name: string } | null;
  return Boolean(row?.name);
}

function hasRequiredColumns(
  db: Database,
  table: string,
  required: readonly string[],
): boolean {
  if (!tableExists(db, table)) {
    return true;
  }

  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  const names = new Set(rows.map((row) => row.name));
  return required.every((column) => names.has(column));
}

function shouldResetSchema(db: Database): boolean {
  for (const table of LEGACY_TABLES) {
    if (tableExists(db, table)) {
      return true;
    }
  }

  return !(
    hasRequiredColumns(db, 'event_journal', [
      'trigger_event_id',
      'review_run_id',
    ]) &&
    hasRequiredColumns(db, 'findings', ['review_run_id', 'details_json']) &&
    hasRequiredColumns(db, 'review_runs', [
      'trigger_event_id',
      'scope',
      'scope_input_json',
    ]) &&
    hasRequiredColumns(db, 'trigger_events', ['event_key', 'subject'])
  );
}

function resetSchema(db: Database): void {
  db.exec('PRAGMA foreign_keys = OFF');
  for (const table of [...LEGACY_TABLES, ...CANONICAL_TABLES]) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  db.exec('PRAGMA foreign_keys = ON');
}

/** Create all tables and indexes if they don't already exist. */
export function ensureSchema(db: Database): void {
  if (shouldResetSchema(db)) {
    resetSchema(db);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS daemon_meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      git_dir TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0,1)) DEFAULT 1,
      paused INTEGER NOT NULL CHECK (paused IN (0,1)) DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_repos_enabled ON repos(enabled, paused);

    CREATE TABLE IF NOT EXISTS trigger_states (
      repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      trigger_id TEXT NOT NULL CHECK (trigger_id IN ('commit','pr','manual')),
      state_json TEXT NOT NULL,
      next_check_at INTEGER,
      last_checked_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (repo_id, trigger_id)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_trigger_states_next_check
      ON trigger_states(trigger_id, next_check_at);

    CREATE TABLE IF NOT EXISTS trigger_events (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      trigger_id TEXT NOT NULL CHECK (trigger_id IN ('commit','pr','manual')),
      event_key TEXT NOT NULL,
      subject TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('fswatch','poll','tool-hook','cli','recovery')),
      detected_at INTEGER NOT NULL,
      UNIQUE(repo_id, trigger_id, event_key)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_trigger_events_repo_detected
      ON trigger_events(repo_id, detected_at DESC);

    CREATE TABLE IF NOT EXISTS review_runs (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      trigger_event_id TEXT NOT NULL REFERENCES trigger_events(id) ON DELETE CASCADE,
      agent TEXT NOT NULL CHECK (agent IN (${AGENT_SQL_LIST})),
      scope TEXT NOT NULL,
      scope_input_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
      priority INTEGER NOT NULL DEFAULT 100,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      queued_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      model_id TEXT,
      variant TEXT,
      session_id TEXT UNIQUE,
      outcome TEXT,
      summary_json TEXT,
      findings_count INTEGER NOT NULL DEFAULT 0,
      raw_output TEXT,
      error_code TEXT,
      error_message TEXT,
      UNIQUE(trigger_event_id, agent)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_review_runs_status_priority
      ON review_runs(status, priority, queued_at);
    CREATE INDEX IF NOT EXISTS idx_review_runs_repo_status
      ON review_runs(repo_id, status);

    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      review_run_id TEXT NOT NULL REFERENCES review_runs(id) ON DELETE CASCADE,
      agent TEXT NOT NULL CHECK (agent IN (${AGENT_SQL_LIST})),
      severity TEXT NOT NULL CHECK (severity IN (${SEVERITY_SQL_LIST})),
      domain TEXT NOT NULL,
      location TEXT NOT NULL,
      evidence TEXT NOT NULL,
      prescription TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      fingerprint TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_findings_repo_created ON findings(repo_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_findings_review_run ON findings(review_run_id);
    CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(fingerprint);

    CREATE TABLE IF NOT EXISTS event_journal (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
      event_type TEXT NOT NULL,
      repo_id TEXT,
      trigger_event_id TEXT,
      review_run_id TEXT,
      message TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_event_ts ON event_journal(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_event_repo_ts ON event_journal(repo_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_event_review_run ON event_journal(review_run_id, seq ASC);
  `);
}
