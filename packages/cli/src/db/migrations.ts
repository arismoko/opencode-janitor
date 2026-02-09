/**
 * Schema migrations for the janitor SQLite database.
 */
import type { Database } from 'bun:sqlite';
import { AGENT_SQL_LIST, SEVERITY_SQL_LIST } from './enum-literals';

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
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
        last_head_sha TEXT,
        last_pr_key TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_repos_enabled ON repos(enabled, paused);

      CREATE TABLE IF NOT EXISTS review_triggers (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('commit','pr','manual')),
        source TEXT NOT NULL CHECK (source IN ('fswatch','poll','tool-hook','cli','recovery')),
        subject_key TEXT NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        detected_at INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_triggers_repo_detected ON review_triggers(repo_id, detected_at DESC);

      CREATE TABLE IF NOT EXISTS review_jobs (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        trigger_id TEXT REFERENCES review_triggers(id) ON DELETE SET NULL,
        dedupe_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
        priority INTEGER NOT NULL DEFAULT 100,
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        cancel_requested INTEGER NOT NULL CHECK (cancel_requested IN (0,1)) DEFAULT 0,
        hub_session_id TEXT,
        queued_at INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER,
        finished_at INTEGER,
        error_code TEXT,
        error_message TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_jobs_status_priority ON review_jobs(status, priority, queued_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_repo_status ON review_jobs(repo_id, status);

      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES review_jobs(id) ON DELETE CASCADE,
        agent TEXT NOT NULL CHECK (agent IN (${AGENT_SQL_LIST})),
        status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','skipped')),
        model_id TEXT,
        variant TEXT,
        session_id TEXT UNIQUE,
        findings_count INTEGER NOT NULL DEFAULT 0,
        raw_output TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        error_code TEXT,
        error_message TEXT,
        UNIQUE(job_id, agent)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_agent_runs_job_status ON agent_runs(job_id, status);

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        job_id TEXT NOT NULL REFERENCES review_jobs(id) ON DELETE CASCADE,
        agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        agent TEXT NOT NULL CHECK (agent IN (${AGENT_SQL_LIST})),
        severity TEXT NOT NULL CHECK (severity IN (${SEVERITY_SQL_LIST})),
        domain TEXT NOT NULL,
        location TEXT NOT NULL,
        evidence TEXT NOT NULL,
        prescription TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_findings_repo_created ON findings(repo_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_findings_job_agent ON findings(job_id, agent);
      CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(fingerprint);

      CREATE TABLE IF NOT EXISTS event_journal (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
        event_type TEXT NOT NULL,
        repo_id TEXT,
        job_id TEXT,
        agent_run_id TEXT,
        message TEXT NOT NULL,
        payload_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_event_ts ON event_journal(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_event_repo_ts ON event_journal(repo_id, ts DESC);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE review_jobs ADD COLUMN last_error_type TEXT;
      ALTER TABLE agent_runs ADD COLUMN outcome TEXT;
      ALTER TABLE agent_runs ADD COLUMN summary_json TEXT;
    `,
  },
  {
    version: 3,
    sql: `
      PRAGMA foreign_keys = OFF;

      ALTER TABLE findings RENAME TO findings_old;
      ALTER TABLE agent_runs RENAME TO agent_runs_old;

      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES review_jobs(id) ON DELETE CASCADE,
        agent TEXT NOT NULL CHECK (agent IN (${AGENT_SQL_LIST})),
        status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','skipped')),
        model_id TEXT,
        variant TEXT,
        session_id TEXT UNIQUE,
        outcome TEXT,
        summary_json TEXT,
        findings_count INTEGER NOT NULL DEFAULT 0,
        raw_output TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        error_code TEXT,
        error_message TEXT,
        UNIQUE(job_id, agent)
      ) STRICT;

      INSERT INTO agent_runs (
        id, job_id, agent, status, model_id, variant, session_id,
        outcome, summary_json, findings_count, raw_output,
        started_at, finished_at, error_code, error_message
      )
      SELECT
        id, job_id, agent, status, model_id, variant, session_id,
        outcome, summary_json, findings_count, raw_output,
        started_at, finished_at, error_code, error_message
      FROM agent_runs_old;

      DROP TABLE agent_runs_old;

      CREATE TABLE findings (
        id TEXT PRIMARY KEY,
        repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
        job_id TEXT NOT NULL REFERENCES review_jobs(id) ON DELETE CASCADE,
        agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
        agent TEXT NOT NULL CHECK (agent IN (${AGENT_SQL_LIST})),
        severity TEXT NOT NULL CHECK (severity IN (${SEVERITY_SQL_LIST})),
        domain TEXT NOT NULL,
        location TEXT NOT NULL,
        evidence TEXT NOT NULL,
        prescription TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;

      INSERT INTO findings (
        id, repo_id, job_id, agent_run_id, agent, severity,
        domain, location, evidence, prescription, fingerprint, created_at
      )
      SELECT
        id, repo_id, job_id, agent_run_id, agent, severity,
        domain, location, evidence, prescription, fingerprint, created_at
      FROM findings_old;

      DROP TABLE findings_old;

      CREATE INDEX IF NOT EXISTS idx_agent_runs_job_status ON agent_runs(job_id, status);
      CREATE INDEX IF NOT EXISTS idx_findings_repo_created ON findings(repo_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_findings_job_agent ON findings(job_id, agent);
      CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(fingerprint);

      PRAGMA foreign_keys = ON;
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE review_jobs ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;

      UPDATE review_jobs
      SET next_attempt_at = queued_at
      WHERE next_attempt_at = 0
        AND status = 'queued';
    `,
  },
];

/** Run all pending migrations transactionally. */
export function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    ) STRICT
  `);

  const appliedRows = db
    .query('SELECT version FROM schema_migrations ORDER BY version ASC')
    .all() as { version: number }[];
  const applied = new Set(appliedRows.map((row) => row.version));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }

    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.query(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      ).run(migration.version, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
