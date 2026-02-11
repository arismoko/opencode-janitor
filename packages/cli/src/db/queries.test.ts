import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { AgentRunSummary } from './models';
import {
  addRepo,
  appendEvent,
  claimNextQueuedJob,
  claimNextQueuedJobWithRepoLimit,
  createAgentRun,
  deleteAgentRun,
  enqueueTriggerAndJob,
  findRepoByIdOrPath,
  getLatestEventSeq,
  insertFindingRows,
  listDashboardAgentState,
  listDashboardReportFindings,
  listDashboardReportSummaries,
  listDashboardRepoState,
  listEvents,
  listEventsAfterSeq,
  listEventsAfterSeqFiltered,
  listRepos,
  listReposDueForCommitCheck,
  listReposDueForPrCheck,
  markAgentRunFailed,
  markAgentRunRunning,
  markAgentRunSucceeded,
  markJobFailed,
  markJobSucceeded,
  type NewRepo,
  recoverRunningAgentRuns,
  recoverRunningJobs,
  removeRepoByIdOrPath,
  requeueJob,
  type TriggerEnqueueInput,
  updateProbeState,
  updateRepoSignals,
} from './queries';

// ---------------------------------------------------------------------------
// Schema DDL — mirrors ensureSchema() but with literal enum values to avoid
// importing shared package in tests.
// ---------------------------------------------------------------------------
const SCHEMA_SQL = `
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
    next_commit_check_at INTEGER NOT NULL DEFAULT 0,
    next_pr_check_at INTEGER NOT NULL DEFAULT 0,
    idle_streak INTEGER NOT NULL DEFAULT 0,
    last_pr_checked_at INTEGER,
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
    last_error_type TEXT,
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
    agent TEXT NOT NULL CHECK (agent IN ('janitor','hunter','inspector','scribe')),
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

  CREATE INDEX IF NOT EXISTS idx_agent_runs_job_status ON agent_runs(job_id, status);

  CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL REFERENCES review_jobs(id) ON DELETE CASCADE,
    agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    agent TEXT NOT NULL CHECK (agent IN ('janitor','hunter','inspector','scribe')),
    severity TEXT NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
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
  CREATE INDEX IF NOT EXISTS idx_event_agent_run ON event_journal(agent_run_id, seq ASC);
`;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

const TEST_REPO: NewRepo = {
  path: '/home/user/project',
  gitDir: '/home/user/project/.git',
  defaultBranch: 'main',
};

function makeTriggerInput(
  repoId: string,
  overrides?: Partial<TriggerEnqueueInput>,
): TriggerEnqueueInput {
  return {
    repoId,
    kind: 'commit',
    source: 'poll',
    subjectKey: 'abc123',
    payload: { sha: 'abc123' },
    ...overrides,
  };
}

/** Insert a repo + trigger + job and return their IDs. */
function seedRepoWithJob(db: Database) {
  const repo = addRepo(db, TEST_REPO);
  const input = makeTriggerInput(repo.id);
  enqueueTriggerAndJob(db, input);
  const job = db
    .query('SELECT * FROM review_jobs WHERE repo_id = ? LIMIT 1')
    .get(repo.id) as { id: string };
  return { repo, jobId: job.id };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let db: Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

// ===========================================================================
// Repo CRUD
// ===========================================================================
describe('Repo CRUD', () => {
  it('addRepo creates a row and returns it', () => {
    const row = addRepo(db, TEST_REPO);

    expect(row.id).toStartWith('repo-');
    expect(row.path).toBe(TEST_REPO.path);
    expect(row.git_dir).toBe(TEST_REPO.gitDir);
    expect(row.default_branch).toBe('main');
    expect(row.enabled).toBe(1);
    expect(row.paused).toBe(0);
    expect(row.created_at).toBeGreaterThan(0);
  });

  it('listRepos returns all added repos', () => {
    addRepo(db, { ...TEST_REPO, path: '/a' });
    addRepo(db, { ...TEST_REPO, path: '/b' });

    const repos = listRepos(db);
    expect(repos).toHaveLength(2);
    const paths = repos.map((r) => r.path).sort();
    expect(paths).toEqual(['/a', '/b']);
  });

  it('listRepos returns empty array when no repos', () => {
    expect(listRepos(db)).toEqual([]);
  });

  it('removeRepoByIdOrPath removes by path', () => {
    const repo = addRepo(db, TEST_REPO);
    const removed = removeRepoByIdOrPath(db, TEST_REPO.path);

    expect(removed).not.toBeNull();
    expect(removed!.id).toBe(repo.id);
    expect(listRepos(db)).toHaveLength(0);
  });

  it('removeRepoByIdOrPath removes by id', () => {
    const repo = addRepo(db, TEST_REPO);
    const removed = removeRepoByIdOrPath(db, repo.id);

    expect(removed).not.toBeNull();
    expect(removed!.id).toBe(repo.id);
  });

  it('removeRepoByIdOrPath returns null for missing repo', () => {
    expect(removeRepoByIdOrPath(db, 'nonexistent')).toBeNull();
  });

  it('findRepoByIdOrPath finds by id', () => {
    const repo = addRepo(db, TEST_REPO);
    const found = findRepoByIdOrPath(db, repo.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(repo.id);
  });

  it('findRepoByIdOrPath finds by path', () => {
    const repo = addRepo(db, TEST_REPO);
    const found = findRepoByIdOrPath(db, TEST_REPO.path);
    expect(found).not.toBeNull();
    expect(found!.path).toBe(repo.path);
  });

  it('findRepoByIdOrPath returns null for missing', () => {
    expect(findRepoByIdOrPath(db, 'nope')).toBeNull();
  });

  it('updateRepoSignals updates HEAD sha', () => {
    const repo = addRepo(db, TEST_REPO);
    updateRepoSignals(db, repo.id, { lastHeadSha: 'deadbeef' });

    const updated = findRepoByIdOrPath(db, repo.id)!;
    expect(updated.last_head_sha).toBe('deadbeef');
    expect(updated.updated_at).toBeGreaterThanOrEqual(repo.updated_at);
  });

  it('updateRepoSignals preserves existing values when null passed', () => {
    const repo = addRepo(db, TEST_REPO);
    updateRepoSignals(db, repo.id, { lastHeadSha: 'aaa' });
    updateRepoSignals(db, repo.id, { lastPrKey: 'pr-1' });

    const updated = findRepoByIdOrPath(db, repo.id)!;
    expect(updated.last_head_sha).toBe('aaa');
    expect(updated.last_pr_key).toBe('pr-1');
  });
});

// ===========================================================================
// Probe state updates
// ===========================================================================
describe('updateProbeState', () => {
  it('updates next check times and idle streak', () => {
    const repo = addRepo(db, TEST_REPO);
    updateProbeState(db, repo.id, {
      nextCommitCheckAt: 5000,
      nextPrCheckAt: 6000,
      idleStreak: 3,
    });

    const updated = findRepoByIdOrPath(db, repo.id)!;
    expect(updated.next_commit_check_at).toBe(5000);
    expect(updated.next_pr_check_at).toBe(6000);
    expect(updated.idle_streak).toBe(3);
  });

  it('updates lastHeadSha and lastPrKey', () => {
    const repo = addRepo(db, TEST_REPO);
    updateProbeState(db, repo.id, {
      lastHeadSha: 'cafe',
      lastPrKey: 'pr-42',
      lastPrCheckedAt: 9999,
    });

    const updated = findRepoByIdOrPath(db, repo.id)!;
    expect(updated.last_head_sha).toBe('cafe');
    expect(updated.last_pr_key).toBe('pr-42');
    expect(updated.last_pr_checked_at).toBe(9999);
  });

  it('listReposDueForCommitCheck returns repos whose check time is past', () => {
    const repo = addRepo(db, TEST_REPO);
    // default next_commit_check_at is 0, so should be due
    const due = listReposDueForCommitCheck(db, Date.now());
    expect(due).toHaveLength(1);
    expect(due[0]!.id).toBe(repo.id);
  });

  it('listReposDueForCommitCheck excludes paused repos', () => {
    const repo = addRepo(db, TEST_REPO);
    db.query('UPDATE repos SET paused = 1 WHERE id = ?').run(repo.id);

    const due = listReposDueForCommitCheck(db, Date.now());
    expect(due).toHaveLength(0);
  });

  it('listReposDueForPrCheck returns repos whose PR check is past', () => {
    const repo = addRepo(db, TEST_REPO);
    const due = listReposDueForPrCheck(db, Date.now());
    expect(due).toHaveLength(1);
    expect(due[0]!.id).toBe(repo.id);
  });
});

// ===========================================================================
// Trigger / Job dedupe
// ===========================================================================
describe('enqueueTriggerAndJob', () => {
  it('inserts trigger and job on first call', () => {
    const repo = addRepo(db, TEST_REPO);
    const input = makeTriggerInput(repo.id);

    const inserted = enqueueTriggerAndJob(db, input);
    expect(inserted).toBe(true);

    const triggers = db
      .query('SELECT * FROM review_triggers WHERE repo_id = ?')
      .all(repo.id);
    expect(triggers).toHaveLength(1);

    const jobs = db
      .query('SELECT * FROM review_jobs WHERE repo_id = ?')
      .all(repo.id);
    expect(jobs).toHaveLength(1);
  });

  it('same subjectKey does NOT create duplicate', () => {
    const repo = addRepo(db, TEST_REPO);
    const input = makeTriggerInput(repo.id, { subjectKey: 'same-sha' });

    expect(enqueueTriggerAndJob(db, input)).toBe(true);
    expect(enqueueTriggerAndJob(db, input)).toBe(false);

    const jobs = db
      .query('SELECT * FROM review_jobs WHERE repo_id = ?')
      .all(repo.id);
    expect(jobs).toHaveLength(1);
  });

  it('different subjectKeys create separate jobs', () => {
    const repo = addRepo(db, TEST_REPO);

    expect(
      enqueueTriggerAndJob(db, makeTriggerInput(repo.id, { subjectKey: 'a' })),
    ).toBe(true);
    expect(
      enqueueTriggerAndJob(db, makeTriggerInput(repo.id, { subjectKey: 'b' })),
    ).toBe(true);

    const jobs = db
      .query('SELECT * FROM review_jobs WHERE repo_id = ?')
      .all(repo.id);
    expect(jobs).toHaveLength(2);
  });

  it('different kinds with same subjectKey create separate jobs', () => {
    const repo = addRepo(db, TEST_REPO);

    expect(
      enqueueTriggerAndJob(
        db,
        makeTriggerInput(repo.id, { kind: 'commit', subjectKey: 'x' }),
      ),
    ).toBe(true);
    expect(
      enqueueTriggerAndJob(
        db,
        makeTriggerInput(repo.id, { kind: 'pr', subjectKey: 'x' }),
      ),
    ).toBe(true);

    const jobs = db
      .query('SELECT * FROM review_jobs WHERE repo_id = ?')
      .all(repo.id);
    expect(jobs).toHaveLength(2);
  });

  it('respects maxAttempts parameter', () => {
    const repo = addRepo(db, TEST_REPO);
    enqueueTriggerAndJob(db, makeTriggerInput(repo.id, { maxAttempts: 5 }));

    const job = db
      .query('SELECT max_attempts FROM review_jobs WHERE repo_id = ?')
      .get(repo.id) as { max_attempts: number };
    expect(job.max_attempts).toBe(5);
  });

  it('defaults maxAttempts to 3', () => {
    const repo = addRepo(db, TEST_REPO);
    enqueueTriggerAndJob(db, makeTriggerInput(repo.id));

    const job = db
      .query('SELECT max_attempts FROM review_jobs WHERE repo_id = ?')
      .get(repo.id) as { max_attempts: number };
    expect(job.max_attempts).toBe(3);
  });
});

// ===========================================================================
// Job claiming
// ===========================================================================
describe('claimNextQueuedJob / claimNextQueuedJobWithRepoLimit', () => {
  it('returns null when no jobs available', () => {
    expect(claimNextQueuedJob(db)).toBeNull();
  });

  it('claims a queued job and sets status to running', () => {
    const { jobId } = seedRepoWithJob(db);

    const claimed = claimNextQueuedJob(db);
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(jobId);
    expect(claimed!.attempt).toBe(1);

    const jobRow = db
      .query('SELECT status, started_at FROM review_jobs WHERE id = ?')
      .get(jobId) as { status: string; started_at: number };
    expect(jobRow.status).toBe('running');
    expect(jobRow.started_at).toBeGreaterThan(0);
  });

  it('does not claim already running jobs', () => {
    seedRepoWithJob(db);

    const first = claimNextQueuedJob(db);
    expect(first).not.toBeNull();

    // No more queued jobs
    const second = claimNextQueuedJob(db);
    expect(second).toBeNull();
  });

  it('respects repo concurrency limit', () => {
    const repo = addRepo(db, TEST_REPO);

    // Enqueue two jobs for the same repo
    enqueueTriggerAndJob(db, makeTriggerInput(repo.id, { subjectKey: 'j1' }));
    enqueueTriggerAndJob(db, makeTriggerInput(repo.id, { subjectKey: 'j2' }));

    // With limit 1: first claim succeeds, second blocked
    const first = claimNextQueuedJobWithRepoLimit(db, 1);
    expect(first).not.toBeNull();

    const second = claimNextQueuedJobWithRepoLimit(db, 1);
    expect(second).toBeNull();
  });

  it('allows claiming when under concurrency limit', () => {
    const repo = addRepo(db, TEST_REPO);

    enqueueTriggerAndJob(db, makeTriggerInput(repo.id, { subjectKey: 'j1' }));
    enqueueTriggerAndJob(db, makeTriggerInput(repo.id, { subjectKey: 'j2' }));

    // With limit 2: both can be claimed
    const first = claimNextQueuedJobWithRepoLimit(db, 2);
    expect(first).not.toBeNull();

    const second = claimNextQueuedJobWithRepoLimit(db, 2);
    expect(second).not.toBeNull();
  });

  it('skips jobs from disabled repos', () => {
    const repo = addRepo(db, TEST_REPO);
    enqueueTriggerAndJob(db, makeTriggerInput(repo.id));
    db.query('UPDATE repos SET enabled = 0 WHERE id = ?').run(repo.id);

    expect(claimNextQueuedJob(db)).toBeNull();
  });

  it('skips jobs from paused repos', () => {
    const repo = addRepo(db, TEST_REPO);
    enqueueTriggerAndJob(db, makeTriggerInput(repo.id));
    db.query('UPDATE repos SET paused = 1 WHERE id = ?').run(repo.id);

    expect(claimNextQueuedJob(db)).toBeNull();
  });

  it('skips cancel-requested jobs', () => {
    const repo = addRepo(db, TEST_REPO);
    enqueueTriggerAndJob(db, makeTriggerInput(repo.id));
    db.query(
      'UPDATE review_jobs SET cancel_requested = 1 WHERE repo_id = ?',
    ).run(repo.id);

    expect(claimNextQueuedJob(db)).toBeNull();
  });

  it('skips jobs whose next_attempt_at is in the future', () => {
    const repo = addRepo(db, TEST_REPO);
    enqueueTriggerAndJob(db, makeTriggerInput(repo.id));
    const farFuture = Date.now() + 999_999_999;
    db.query(
      'UPDATE review_jobs SET next_attempt_at = ? WHERE repo_id = ?',
    ).run(farFuture, repo.id);

    expect(claimNextQueuedJob(db)).toBeNull();
  });

  it('returns joined repo and trigger fields', () => {
    const { repo } = seedRepoWithJob(db);

    const claimed = claimNextQueuedJob(db)!;
    expect(claimed.path).toBe(repo.path);
    expect(claimed.default_branch).toBe('main');
    expect(claimed.kind).toBe('commit');
    expect(claimed.subject_key).toBe('abc123');
    expect(claimed.payload_json).toBe(JSON.stringify({ sha: 'abc123' }));
  });
});

// ===========================================================================
// Job status transitions (retry)
// ===========================================================================
describe('Retry transitions', () => {
  it('markJobSucceeded sets status and finished_at', () => {
    const { jobId } = seedRepoWithJob(db);
    claimNextQueuedJob(db);

    markJobSucceeded(db, jobId);

    const row = db
      .query('SELECT status, finished_at FROM review_jobs WHERE id = ?')
      .get(jobId) as { status: string; finished_at: number };
    expect(row.status).toBe('succeeded');
    expect(row.finished_at).toBeGreaterThan(0);
  });

  it('markJobFailed sets status, error details, and finished_at', () => {
    const { jobId } = seedRepoWithJob(db);
    claimNextQueuedJob(db);

    markJobFailed(db, jobId, 'TIMEOUT', 'timed out', 'transient');

    const row = db
      .query(
        'SELECT status, error_code, error_message, last_error_type, finished_at FROM review_jobs WHERE id = ?',
      )
      .get(jobId) as {
      status: string;
      error_code: string;
      error_message: string;
      last_error_type: string;
      finished_at: number;
    };
    expect(row.status).toBe('failed');
    expect(row.error_code).toBe('TIMEOUT');
    expect(row.error_message).toBe('timed out');
    expect(row.last_error_type).toBe('transient');
    expect(row.finished_at).toBeGreaterThan(0);
  });

  it('requeueJob resets status to queued and records error info', () => {
    const { jobId } = seedRepoWithJob(db);
    claimNextQueuedJob(db);

    const nextAt = Date.now() + 10_000;
    requeueJob(db, jobId, 'RETRY', 'transient error', nextAt, 'transient');

    const row = db
      .query(
        'SELECT status, started_at, error_code, error_message, next_attempt_at, last_error_type FROM review_jobs WHERE id = ?',
      )
      .get(jobId) as {
      status: string;
      started_at: number | null;
      error_code: string;
      error_message: string;
      next_attempt_at: number;
      last_error_type: string;
    };
    expect(row.status).toBe('queued');
    expect(row.started_at).toBeNull();
    expect(row.error_code).toBe('RETRY');
    expect(row.error_message).toBe('transient error');
    expect(row.next_attempt_at).toBe(nextAt);
    expect(row.last_error_type).toBe('transient');
  });

  it('requeueJob then re-claim increments attempt count', () => {
    const { jobId } = seedRepoWithJob(db);

    // First claim: attempt 0 -> 1
    const first = claimNextQueuedJob(db)!;
    expect(first.attempt).toBe(1);

    // Requeue for retry
    requeueJob(db, jobId, 'RETRY', 'err', Date.now(), 'transient');

    // Second claim: attempt 1 -> 2
    const second = claimNextQueuedJob(db)!;
    expect(second.attempt).toBe(2);
  });

  it('recoverRunningJobs resets running jobs to queued', () => {
    const { jobId } = seedRepoWithJob(db);
    claimNextQueuedJob(db);

    const count = recoverRunningJobs(db);
    expect(count).toBe(1);

    const row = db
      .query('SELECT status, started_at FROM review_jobs WHERE id = ?')
      .get(jobId) as { status: string; started_at: number | null };
    expect(row.status).toBe('queued');
    expect(row.started_at).toBeNull();
  });

  it('recoverRunningJobs returns 0 when no running jobs', () => {
    expect(recoverRunningJobs(db)).toBe(0);
  });
});

// ===========================================================================
// Agent run creation and lifecycle
// ===========================================================================
describe('createAgentRun', () => {
  it('creates a new agent run row', () => {
    const { jobId } = seedRepoWithJob(db);

    const runId = createAgentRun(db, { jobId, agent: 'janitor' });
    expect(runId).toStartWith('arn-');

    const row = db
      .query('SELECT * FROM agent_runs WHERE id = ?')
      .get(runId) as { status: string; agent: string; findings_count: number };
    expect(row.status).toBe('queued');
    expect(row.agent).toBe('janitor');
    expect(row.findings_count).toBe(0);
  });

  it('resets existing run for same job+agent instead of duplicating', () => {
    const { jobId } = seedRepoWithJob(db);

    const id1 = createAgentRun(db, { jobId, agent: 'janitor' });

    // Mark running then succeeded
    markAgentRunRunning(db, id1, 'sess-1');
    markAgentRunSucceeded(db, id1, 2, 'output', {
      outcome: 'succeeded',
      retryable: false,
      findingsCount: 2,
      durationMs: 100,
      sessionId: 'sess-1',
      completion: 'idle',
    });

    // Re-create for same job+agent — should reset, not insert
    const id2 = createAgentRun(db, { jobId, agent: 'janitor' });
    expect(id2).toBe(id1);

    const row = db
      .query(
        'SELECT status, session_id, outcome, findings_count FROM agent_runs WHERE id = ?',
      )
      .get(id1) as {
      status: string;
      session_id: string | null;
      outcome: string | null;
      findings_count: number;
    };
    expect(row.status).toBe('queued');
    expect(row.session_id).toBeNull();
    expect(row.outcome).toBeNull();
    expect(row.findings_count).toBe(0);
  });

  it('createAgentRun clears old findings on re-creation', () => {
    const { repo, jobId } = seedRepoWithJob(db);
    const runId = createAgentRun(db, { jobId, agent: 'janitor' });

    insertFindingRows(db, [
      {
        repo_id: repo.id,
        job_id: jobId,
        agent_run_id: runId,
        agent: 'janitor',
        severity: 'P1',
        domain: 'DRY',
        location: 'src/foo.ts:10',
        evidence: 'dup',
        prescription: 'remove dup',
        fingerprint: 'fp-1',
      },
    ]);

    const before = db
      .query('SELECT COUNT(*) AS cnt FROM findings WHERE agent_run_id = ?')
      .get(runId) as { cnt: number };
    expect(before.cnt).toBe(1);

    // Re-create — should delete old findings
    createAgentRun(db, { jobId, agent: 'janitor' });

    const after = db
      .query('SELECT COUNT(*) AS cnt FROM findings WHERE agent_run_id = ?')
      .get(runId) as { cnt: number };
    expect(after.cnt).toBe(0);
  });

  it('different agents for same job create separate runs', () => {
    const { jobId } = seedRepoWithJob(db);

    const id1 = createAgentRun(db, { jobId, agent: 'janitor' });
    const id2 = createAgentRun(db, { jobId, agent: 'hunter' });

    expect(id1).not.toBe(id2);

    const runs = db
      .query('SELECT * FROM agent_runs WHERE job_id = ?')
      .all(jobId);
    expect(runs).toHaveLength(2);
  });
});

describe('Agent run lifecycle', () => {
  it('markAgentRunRunning sets status and session_id', () => {
    const { jobId } = seedRepoWithJob(db);
    const runId = createAgentRun(db, { jobId, agent: 'janitor' });

    markAgentRunRunning(db, runId, 'sess-abc');

    const row = db
      .query(
        'SELECT status, session_id, started_at FROM agent_runs WHERE id = ?',
      )
      .get(runId) as { status: string; session_id: string; started_at: number };
    expect(row.status).toBe('running');
    expect(row.session_id).toBe('sess-abc');
    expect(row.started_at).toBeGreaterThan(0);
  });

  it('markAgentRunSucceeded sets outcome, findings_count, raw_output', () => {
    const { jobId } = seedRepoWithJob(db);
    const runId = createAgentRun(db, { jobId, agent: 'janitor' });
    markAgentRunRunning(db, runId);

    const summary: AgentRunSummary = {
      outcome: 'succeeded',
      retryable: false,
      findingsCount: 3,
      durationMs: 500,
      sessionId: null,
      completion: 'idle',
    };
    markAgentRunSucceeded(db, runId, 3, 'raw output text', summary);

    const row = db
      .query(
        'SELECT status, outcome, findings_count, raw_output, finished_at, summary_json FROM agent_runs WHERE id = ?',
      )
      .get(runId) as {
      status: string;
      outcome: string;
      findings_count: number;
      raw_output: string;
      finished_at: number;
      summary_json: string;
    };
    expect(row.status).toBe('succeeded');
    expect(row.outcome).toBe('succeeded');
    expect(row.findings_count).toBe(3);
    expect(row.raw_output).toBe('raw output text');
    expect(row.finished_at).toBeGreaterThan(0);
    expect(JSON.parse(row.summary_json)).toEqual(summary);
  });

  it('markAgentRunFailed sets error details and outcome', () => {
    const { jobId } = seedRepoWithJob(db);
    const runId = createAgentRun(db, { jobId, agent: 'janitor' });
    markAgentRunRunning(db, runId);

    const summary: AgentRunSummary = {
      outcome: 'failed_transient',
      retryable: true,
      findingsCount: 0,
      durationMs: 100,
      sessionId: null,
      completion: 'error',
      errorCode: 'AGENT_TIMEOUT',
      errorMessage: 'timed out',
    };
    markAgentRunFailed(db, runId, 'AGENT_TIMEOUT', 'timed out', summary);

    const row = db
      .query(
        'SELECT status, outcome, error_code, error_message, finished_at FROM agent_runs WHERE id = ?',
      )
      .get(runId) as {
      status: string;
      outcome: string;
      error_code: string;
      error_message: string;
      finished_at: number;
    };
    expect(row.status).toBe('failed');
    expect(row.outcome).toBe('failed_transient');
    expect(row.error_code).toBe('AGENT_TIMEOUT');
    expect(row.error_message).toBe('timed out');
    expect(row.finished_at).toBeGreaterThan(0);
  });

  it('recoverRunningAgentRuns resets running runs', () => {
    const { jobId } = seedRepoWithJob(db);
    const runId = createAgentRun(db, { jobId, agent: 'janitor' });
    markAgentRunRunning(db, runId, 'sess-1');

    const count = recoverRunningAgentRuns(db);
    expect(count).toBe(1);

    const row = db
      .query(
        'SELECT status, session_id, started_at FROM agent_runs WHERE id = ?',
      )
      .get(runId) as {
      status: string;
      session_id: string | null;
      started_at: number | null;
    };
    expect(row.status).toBe('queued');
    expect(row.session_id).toBeNull();
    expect(row.started_at).toBeNull();
  });

  it('deleteAgentRun removes run and its findings', () => {
    const { repo, jobId } = seedRepoWithJob(db);
    const runId = createAgentRun(db, { jobId, agent: 'janitor' });

    insertFindingRows(db, [
      {
        repo_id: repo.id,
        job_id: jobId,
        agent_run_id: runId,
        agent: 'janitor',
        severity: 'P0',
        domain: 'DEAD',
        location: 'file.ts:1',
        evidence: 'dead code',
        prescription: 'remove it',
        fingerprint: 'fp-del',
      },
    ]);

    const deleted = deleteAgentRun(db, runId);
    expect(deleted).toBe(true);

    const run = db.query('SELECT * FROM agent_runs WHERE id = ?').get(runId);
    expect(run).toBeNull();

    const findings = db
      .query('SELECT * FROM findings WHERE agent_run_id = ?')
      .all(runId);
    expect(findings).toHaveLength(0);
  });

  it('deleteAgentRun returns false for nonexistent run', () => {
    expect(deleteAgentRun(db, 'nope')).toBe(false);
  });

  it('deleteAgentRun does not delete running runs', () => {
    const { jobId } = seedRepoWithJob(db);
    const runId = createAgentRun(db, { jobId, agent: 'janitor' });
    markAgentRunRunning(db, runId);

    const deleted = deleteAgentRun(db, runId);
    expect(deleted).toBe(false);

    const run = db.query('SELECT * FROM agent_runs WHERE id = ?').get(runId);
    expect(run).not.toBeNull();
  });
});

// ===========================================================================
// Findings
// ===========================================================================
describe('insertFindingRows', () => {
  it('inserts multiple findings in one transaction', () => {
    const { repo, jobId } = seedRepoWithJob(db);
    const runId = createAgentRun(db, { jobId, agent: 'janitor' });

    insertFindingRows(db, [
      {
        repo_id: repo.id,
        job_id: jobId,
        agent_run_id: runId,
        agent: 'janitor',
        severity: 'P0',
        domain: 'DEAD',
        location: 'a.ts:1',
        evidence: 'unused',
        prescription: 'remove',
        fingerprint: 'fp-1',
      },
      {
        repo_id: repo.id,
        job_id: jobId,
        agent_run_id: runId,
        agent: 'janitor',
        severity: 'P2',
        domain: 'DRY',
        location: 'b.ts:5',
        evidence: 'dup logic',
        prescription: 'extract',
        fingerprint: 'fp-2',
      },
    ]);

    const rows = db
      .query('SELECT * FROM findings WHERE agent_run_id = ?')
      .all(runId);
    expect(rows).toHaveLength(2);
  });

  it('replaces old findings for the same agent run', () => {
    const { repo, jobId } = seedRepoWithJob(db);
    const runId = createAgentRun(db, { jobId, agent: 'janitor' });

    // Insert initial
    insertFindingRows(db, [
      {
        repo_id: repo.id,
        job_id: jobId,
        agent_run_id: runId,
        agent: 'janitor',
        severity: 'P0',
        domain: 'DEAD',
        location: 'a.ts:1',
        evidence: 'old',
        prescription: 'old fix',
        fingerprint: 'fp-old',
      },
    ]);

    // Replace
    insertFindingRows(db, [
      {
        repo_id: repo.id,
        job_id: jobId,
        agent_run_id: runId,
        agent: 'janitor',
        severity: 'P1',
        domain: 'YAGNI',
        location: 'c.ts:3',
        evidence: 'new',
        prescription: 'new fix',
        fingerprint: 'fp-new',
      },
    ]);

    const rows = db
      .query('SELECT * FROM findings WHERE agent_run_id = ?')
      .all(runId) as { fingerprint: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fingerprint).toBe('fp-new');
  });

  it('no-ops on empty rows', () => {
    insertFindingRows(db, []);
    const count = db.query('SELECT COUNT(*) AS cnt FROM findings').get() as {
      cnt: number;
    };
    expect(count.cnt).toBe(0);
  });
});

// ===========================================================================
// Event logging
// ===========================================================================
describe('Event logging', () => {
  it('appendEvent persists an event', () => {
    appendEvent(db, {
      eventType: 'job.queued',
      message: 'Job queued',
      level: 'info',
    });

    const events = listEvents(db, 10);
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('job.queued');
    expect(events[0]!.message).toBe('Job queued');
    expect(events[0]!.level).toBe('info');
    expect(events[0]!.payload_json).toBe('{}');
  });

  it('appendEvent defaults level to info', () => {
    appendEvent(db, { eventType: 'test', message: 'hello' });

    const events = listEvents(db, 1);
    expect(events[0]!.level).toBe('info');
  });

  it('appendEvent stores payload as JSON', () => {
    appendEvent(db, {
      eventType: 'test',
      message: 'with data',
      payload: { key: 'value', count: 42 },
    });

    const events = listEvents(db, 1);
    const parsed = JSON.parse(events[0]!.payload_json);
    expect(parsed).toEqual({ key: 'value', count: 42 });
  });

  it('appendEvent stores optional foreign keys', () => {
    const repo = addRepo(db, TEST_REPO);
    appendEvent(db, {
      eventType: 'repo.added',
      message: 'Repo added',
      repoId: repo.id,
      jobId: 'job-xyz',
      agentRunId: 'arn-abc',
    });

    const events = listEvents(db, 1);
    expect(events[0]!.repo_id).toBe(repo.id);
    expect(events[0]!.job_id).toBe('job-xyz');
    expect(events[0]!.agent_run_id).toBe('arn-abc');
  });

  it('listEvents returns newest first (by seq DESC)', () => {
    appendEvent(db, { eventType: 'first', message: 'first' });
    appendEvent(db, { eventType: 'second', message: 'second' });
    appendEvent(db, { eventType: 'third', message: 'third' });

    const events = listEvents(db, 10);
    expect(events).toHaveLength(3);
    expect(events[0]!.event_type).toBe('third');
    expect(events[2]!.event_type).toBe('first');
  });

  it('listEvents respects limit', () => {
    for (let i = 0; i < 5; i++) {
      appendEvent(db, { eventType: `e${i}`, message: `msg ${i}` });
    }

    const events = listEvents(db, 2);
    expect(events).toHaveLength(2);
  });

  it('getLatestEventSeq returns 0 for empty journal', () => {
    expect(getLatestEventSeq(db)).toBe(0);
  });

  it('getLatestEventSeq returns the highest sequence number', () => {
    appendEvent(db, { eventType: 'a', message: 'a' });
    appendEvent(db, { eventType: 'b', message: 'b' });

    const seq = getLatestEventSeq(db);
    expect(seq).toBe(2);
  });

  it('listEventsAfterSeq returns events after cursor, oldest first', () => {
    appendEvent(db, { eventType: 'a', message: 'a' });
    appendEvent(db, { eventType: 'b', message: 'b' });
    appendEvent(db, { eventType: 'c', message: 'c' });

    const events = listEventsAfterSeq(db, 1, 10);
    expect(events).toHaveLength(2);
    expect(events[0]!.event_type).toBe('b');
    expect(events[1]!.event_type).toBe('c');
  });
});

// ===========================================================================
// Filtered event queries
// ===========================================================================
describe('listEventsAfterSeqFiltered', () => {
  it('returns all events when no filters', () => {
    appendEvent(db, { eventType: 'a', message: 'a' });
    appendEvent(db, { eventType: 'b', message: 'b' });

    const events = listEventsAfterSeqFiltered(db, 0, 100);
    expect(events).toHaveLength(2);
  });

  it('filters by repoId', () => {
    const repo = addRepo(db, TEST_REPO);
    appendEvent(db, { eventType: 'a', message: 'a', repoId: repo.id });
    appendEvent(db, { eventType: 'b', message: 'b', repoId: 'other' });

    const events = listEventsAfterSeqFiltered(db, 0, 100, {
      repoId: repo.id,
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('a');
  });

  it('filters by topic (event_type)', () => {
    appendEvent(db, { eventType: 'job.queued', message: 'a' });
    appendEvent(db, { eventType: 'job.started', message: 'b' });

    const events = listEventsAfterSeqFiltered(db, 0, 100, {
      topic: 'job.queued',
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('job.queued');
  });

  it('filters by sessionId via agent_runs join', () => {
    const { jobId } = seedRepoWithJob(db);
    const runId = createAgentRun(db, { jobId, agent: 'janitor' });
    markAgentRunRunning(db, runId, 'sess-xyz');

    appendEvent(db, {
      eventType: 'run.progress',
      message: 'matched',
      agentRunId: runId,
    });
    appendEvent(db, { eventType: 'other', message: 'unmatched' });

    const events = listEventsAfterSeqFiltered(db, 0, 100, {
      sessionId: 'sess-xyz',
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.message).toBe('matched');
    expect(events[0]!.session_id).toBe('sess-xyz');
  });

  it('combines multiple filters', () => {
    const repo = addRepo(db, TEST_REPO);
    appendEvent(db, {
      eventType: 'job.queued',
      message: 'match',
      repoId: repo.id,
    });
    appendEvent(db, {
      eventType: 'job.started',
      message: 'wrong type',
      repoId: repo.id,
    });
    appendEvent(db, {
      eventType: 'job.queued',
      message: 'wrong repo',
      repoId: 'other',
    });

    const events = listEventsAfterSeqFiltered(db, 0, 100, {
      repoId: repo.id,
      topic: 'job.queued',
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.message).toBe('match');
  });
});

// ===========================================================================
// Dashboard queries
// ===========================================================================
describe('Dashboard queries', () => {
  it('listDashboardRepoState includes job counts', () => {
    const repo = addRepo(db, TEST_REPO);
    enqueueTriggerAndJob(db, makeTriggerInput(repo.id, { subjectKey: 'q1' }));
    enqueueTriggerAndJob(db, makeTriggerInput(repo.id, { subjectKey: 'q2' }));

    // Claim one job → 1 running, 1 queued
    claimNextQueuedJobWithRepoLimit(db, 2);

    const rows = listDashboardRepoState(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.queued_jobs).toBe(1);
    expect(rows[0]!.running_jobs).toBe(1);
  });

  it('listDashboardRepoState includes latest event timestamp', () => {
    const repo = addRepo(db, TEST_REPO);
    appendEvent(db, {
      eventType: 'test',
      message: 'event',
      repoId: repo.id,
    });

    const rows = listDashboardRepoState(db);
    expect(rows[0]!.latest_event_ts).toBeGreaterThan(0);
  });

  it('listDashboardAgentState aggregates agent runs', () => {
    const { jobId } = seedRepoWithJob(db);
    const runId = createAgentRun(db, { jobId, agent: 'janitor' });
    markAgentRunRunning(db, runId);
    markAgentRunSucceeded(db, runId, 0, '', {
      outcome: 'succeeded',
      retryable: false,
      findingsCount: 0,
      durationMs: 50,
      sessionId: null,
      completion: 'idle',
    });

    const rows = listDashboardAgentState(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agent).toBe('janitor');
    expect(rows[0]!.succeeded_runs).toBe(1);
  });

  it('listDashboardReportSummaries returns recent reports', () => {
    const { repo, jobId } = seedRepoWithJob(db);
    const runId = createAgentRun(db, { jobId, agent: 'janitor' });
    markAgentRunRunning(db, runId);
    markAgentRunSucceeded(db, runId, 1, 'output', {
      outcome: 'succeeded',
      retryable: false,
      findingsCount: 1,
      durationMs: 100,
      sessionId: null,
      completion: 'idle',
    });

    insertFindingRows(db, [
      {
        repo_id: repo.id,
        job_id: jobId,
        agent_run_id: runId,
        agent: 'janitor',
        severity: 'P1',
        domain: 'DRY',
        location: 'x.ts:1',
        evidence: 'dup',
        prescription: 'fix',
        fingerprint: 'fp-rpt',
      },
    ]);

    const summaries = listDashboardReportSummaries(db, 10);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.repo_path).toBe(repo.path);
    expect(summaries[0]!.agent).toBe('janitor');
    expect(summaries[0]!.status).toBe('succeeded');
    expect(summaries[0]!.p1_count).toBe(1);
  });

  it('listDashboardReportFindings returns findings sorted by severity', () => {
    const { repo, jobId } = seedRepoWithJob(db);
    const runId = createAgentRun(db, { jobId, agent: 'janitor' });

    insertFindingRows(db, [
      {
        repo_id: repo.id,
        job_id: jobId,
        agent_run_id: runId,
        agent: 'janitor',
        severity: 'P2',
        domain: 'DRY',
        location: 'a.ts:1',
        evidence: 'low',
        prescription: 'fix',
        fingerprint: 'fp-p2',
      },
      {
        repo_id: repo.id,
        job_id: jobId,
        agent_run_id: runId,
        agent: 'janitor',
        severity: 'P0',
        domain: 'DEAD',
        location: 'b.ts:1',
        evidence: 'critical',
        prescription: 'fix now',
        fingerprint: 'fp-p0',
      },
    ]);

    const findings = listDashboardReportFindings(db, runId, 10);
    expect(findings).toHaveLength(2);
    // P0 should come first
    expect(findings[0]!.severity).toBe('P0');
    expect(findings[1]!.severity).toBe('P2');
  });
});
