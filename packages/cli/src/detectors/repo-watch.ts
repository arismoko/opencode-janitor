import type { Database } from 'bun:sqlite';
import {
  appendEvent,
  enqueueTriggerAndJob,
  listRepos,
  updateRepoSignals,
} from '../db/queries';
import { resolveCurrentPrKey, resolveHeadSha } from '../utils/git';

export interface RepoWatchOptions {
  db: Database;
  commitPollMs: number;
  prPollMs: number;
  maxAttempts: number;
  onJobEnqueued?: () => void;
}

export interface RepoWatchHandle {
  stop: () => void;
}

function scanCommitSignals(options: RepoWatchOptions): void {
  const { db, maxAttempts } = options;
  const repos = listRepos(db).filter(
    (repo) => repo.enabled === 1 && repo.paused === 0,
  );

  for (const repo of repos) {
    try {
      const headSha = resolveHeadSha(repo.path);
      if (headSha === repo.last_head_sha) {
        continue;
      }

      updateRepoSignals(db, repo.id, { lastHeadSha: headSha });

      const inserted = enqueueTriggerAndJob(db, {
        repoId: repo.id,
        kind: 'commit',
        source: 'poll',
        subjectKey: `commit:${headSha}`,
        payload: { path: repo.path, sha: headSha },
        maxAttempts,
      });

      if (inserted) {
        options.onJobEnqueued?.();
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
    }
  }
}

function scanPrSignals(options: RepoWatchOptions): void {
  const { db, maxAttempts } = options;
  const repos = listRepos(db).filter(
    (repo) => repo.enabled === 1 && repo.paused === 0,
  );

  for (const repo of repos) {
    try {
      const prKey = resolveCurrentPrKey(repo.path);
      if (!prKey || prKey === repo.last_pr_key) {
        continue;
      }

      updateRepoSignals(db, repo.id, { lastPrKey: prKey });

      const inserted = enqueueTriggerAndJob(db, {
        repoId: repo.id,
        kind: 'pr',
        source: 'poll',
        subjectKey: `pr:${prKey}`,
        payload: { path: repo.path, prKey },
        maxAttempts,
      });

      if (inserted) {
        options.onJobEnqueued?.();
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
    }
  }
}

export function startRepoWatch(options: RepoWatchOptions): RepoWatchHandle {
  let commitBusy = false;
  let prBusy = false;

  const commitTimer = setInterval(() => {
    if (commitBusy) {
      return;
    }

    commitBusy = true;
    try {
      scanCommitSignals(options);
    } finally {
      commitBusy = false;
    }
  }, options.commitPollMs);

  const prTimer = setInterval(() => {
    if (prBusy) {
      return;
    }

    prBusy = true;
    try {
      scanPrSignals(options);
    } finally {
      prBusy = false;
    }
  }, options.prPollMs);

  // Prime initial state immediately.
  scanCommitSignals(options);
  scanPrSignals(options);

  return {
    stop: () => {
      clearInterval(commitTimer);
      clearInterval(prTimer);
    },
  };
}
