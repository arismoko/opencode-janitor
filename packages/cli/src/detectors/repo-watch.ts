/**
 * Detector — due-time scheduler with bounded async probe pool.
 *
 * Per-repo scheduling with idle backoff (15s → 60s), PR TTL gating,
 * and bounded concurrency.
 *
 * @see PLAN.md P1.6 — Detector Scalability Pass
 */
import type { Database } from 'bun:sqlite';
import {
  type DetectorRepoView,
  listReposDueForCommitCheck,
  listReposDueForPrCheck,
  updateProbeState,
} from '../db/queries/detector-queries';
import { appendEvent } from '../db/queries/event-queries';
import { enqueueTriggerAndJob } from '../db/queries/repo-queries';
import {
  buildCommitPayload,
  buildPrPayloadFromKey,
} from '../runtime/review-job-payload';
import { resolveCurrentPrKeyAsync, resolveHeadShaAsync } from '../utils/git';
import { nowMs } from '../utils/time';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepoWatchOptions {
  db: Database;
  minPollSec: number;
  maxPollSec: number;
  probeConcurrency: number;
  prTtlSec: number;
  pollJitterPct: number;
  maxAttempts: number;
  onJobEnqueued?: () => void;
}

export interface RepoWatchHandle {
  stop: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TICK_INTERVAL_MS = 1_000;
const ERROR_COOLDOWN_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jitterMs(baseMs: number, jitterPct: number): number {
  if (jitterPct <= 0) return baseMs;
  const factor = 1 + (Math.random() * 2 - 1) * (jitterPct / 100);
  return Math.round(baseMs * factor);
}

function computeNextCheckAt(
  minPollMs: number,
  maxPollMs: number,
  idleStreak: number,
  jitterPct: number,
): number {
  // Simple two-step policy: active repos at minPollMs, idle repos at maxPollMs.
  const baseMs = idleStreak > 0 ? maxPollMs : minPollMs;
  return nowMs() + jitterMs(baseMs, jitterPct);
}

// ---------------------------------------------------------------------------
// Probe tasks
// ---------------------------------------------------------------------------

async function probeCommit(
  opts: RepoWatchOptions,
  repo: DetectorRepoView,
): Promise<void> {
  const { db, minPollSec, maxPollSec, pollJitterPct, maxAttempts } = opts;
  const minPollMs = minPollSec * 1000;
  const maxPollMs = maxPollSec * 1000;

  try {
    const headSha = await resolveHeadShaAsync(repo.path);

    if (headSha === repo.last_head_sha) {
      // No change — bump idle streak and schedule at idle cadence.
      const newStreak = repo.idle_streak + 1;
      updateProbeState(db, repo.id, {
        idleStreak: newStreak,
        nextCommitCheckAt: computeNextCheckAt(
          minPollMs,
          maxPollMs,
          newStreak,
          pollJitterPct,
        ),
      });
      return;
    }

    // Activity detected — reset idle streak and enqueue.
    updateProbeState(db, repo.id, {
      lastHeadSha: headSha,
      idleStreak: 0,
      nextCommitCheckAt: computeNextCheckAt(
        minPollMs,
        maxPollMs,
        0,
        pollJitterPct,
      ),
    });

    const inserted = enqueueTriggerAndJob(db, {
      repoId: repo.id,
      kind: 'commit',
      source: 'poll',
      subjectKey: `commit:${headSha}`,
      payload: buildCommitPayload(headSha),
      maxAttempts,
    });

    if (inserted) {
      opts.onJobEnqueued?.();
      appendEvent(db, {
        eventType: 'trigger.detected',
        repoId: repo.id,
        message: `Detected commit ${headSha.slice(0, 12)} in ${repo.path}`,
        payload: { kind: 'commit', sha: headSha },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendEvent(db, {
      eventType: 'detector.error',
      repoId: repo.id,
      level: 'warn',
      message: `Commit detector failed for ${repo.path}: ${message}`,
      payload: { detector: 'commit' },
    });
    // Error cooldown — schedule next check further out.
    updateProbeState(db, repo.id, {
      nextCommitCheckAt: nowMs() + ERROR_COOLDOWN_MS,
    });
  }
}

async function probePr(
  opts: RepoWatchOptions,
  repo: DetectorRepoView,
): Promise<void> {
  const { db, minPollSec, maxPollSec, prTtlSec, pollJitterPct, maxAttempts } =
    opts;
  const minPollMs = minPollSec * 1000;
  const maxPollMs = maxPollSec * 1000;
  const now = nowMs();

  // PR TTL gating: skip if we checked recently and HEAD hasn't changed.
  if (
    prTtlSec > 0 &&
    repo.last_pr_checked_at !== null &&
    now - repo.last_pr_checked_at < prTtlSec * 1000
  ) {
    // Still within TTL — reschedule at TTL expiry.
    updateProbeState(db, repo.id, {
      nextPrCheckAt: repo.last_pr_checked_at + prTtlSec * 1000,
    });
    return;
  }

  try {
    const prKey = await resolveCurrentPrKeyAsync(repo.path);

    // Mark that we checked.
    const stateUpdate: Parameters<typeof updateProbeState>[2] = {
      lastPrCheckedAt: now,
      nextPrCheckAt: computeNextCheckAt(
        minPollMs,
        maxPollMs,
        repo.idle_streak,
        pollJitterPct,
      ),
    };

    // Dedup on full prKey (number:headSha) — each push to the PR gets a new
    // review. This matches the old plugin behavior where push detection
    // triggered hunter on every new head commit.
    if (!prKey || prKey === repo.last_pr_key) {
      // No PR on this branch, or same head sha — update stored key but don't enqueue.
      stateUpdate.lastPrKey = prKey;
      updateProbeState(db, repo.id, stateUpdate);
      return;
    }

    // New PR activity.
    stateUpdate.lastPrKey = prKey;
    updateProbeState(db, repo.id, stateUpdate);

    const inserted = enqueueTriggerAndJob(db, {
      repoId: repo.id,
      kind: 'pr',
      source: 'poll',
      subjectKey: `pr:${prKey}`,
      payload: buildPrPayloadFromKey(prKey),
      maxAttempts,
    });

    if (inserted) {
      opts.onJobEnqueued?.();
      appendEvent(db, {
        eventType: 'trigger.detected',
        repoId: repo.id,
        message: `Detected PR update ${prKey} in ${repo.path}`,
        payload: { kind: 'pr', prKey },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendEvent(db, {
      eventType: 'detector.error',
      repoId: repo.id,
      level: 'warn',
      message: `PR detector failed for ${repo.path}: ${message}`,
      payload: { detector: 'pr' },
    });
    updateProbeState(db, repo.id, {
      nextPrCheckAt: now + ERROR_COOLDOWN_MS,
    });
  }
}

// ---------------------------------------------------------------------------
// Bounded probe pool
// ---------------------------------------------------------------------------

type ProbeTask = () => Promise<void>;

async function drainPool(
  tasks: ProbeTask[],
  concurrency: number,
): Promise<void> {
  let index = 0;

  const worker = async (): Promise<void> => {
    while (index < tasks.length) {
      const task = tasks[index++]!;
      await task();
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Tick — the single detector heartbeat
// ---------------------------------------------------------------------------

async function tick(opts: RepoWatchOptions): Promise<void> {
  const { db, probeConcurrency } = opts;
  const now = nowMs();

  const commitDue = listReposDueForCommitCheck(db, now);
  const prDue = listReposDueForPrCheck(db, now);

  const tasks: ProbeTask[] = [
    ...commitDue.map((repo) => () => probeCommit(opts, repo)),
    ...prDue.map((repo) => () => probePr(opts, repo)),
  ];

  if (tasks.length === 0) return;

  await drainPool(tasks, probeConcurrency);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startRepoWatch(opts: RepoWatchOptions): RepoWatchHandle {
  let running = true;
  let tickBusy = false;

  const timer = setInterval(async () => {
    if (!running || tickBusy) return;
    tickBusy = true;
    try {
      await tick(opts);
    } finally {
      tickBusy = false;
    }
  }, TICK_INTERVAL_MS);

  // Prime: run first tick immediately, guarded by tickBusy so the
  // interval handler cannot start a concurrent tick if it fires first.
  tickBusy = true;
  tick(opts)
    .catch(() => {
      // Errors are handled per-repo in probeCommit/probePr.
    })
    .finally(() => {
      tickBusy = false;
    });

  return {
    stop: () => {
      running = false;
      clearInterval(timer);
    },
  };
}
