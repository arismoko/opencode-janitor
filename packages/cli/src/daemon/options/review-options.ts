import { resolve as resolvePath } from 'node:path';
import { manualKey, prKey } from '@opencode-janitor/shared';
import { appendEvent } from '../../db/queries/event-queries';
import {
  enqueueTriggerAndJob,
  findRepoByIdOrPath,
} from '../../db/queries/repo-queries';
import type { RuntimeContext } from '../../runtime/context';
import { buildManualPayload } from '../../runtime/review-job-payload';
import { resolveHeadSha, resolvePrHeadShaAsync } from '../../utils/git';
import type { ReviewApi } from '../socket-types';

export function createReviewOptions(rc: RuntimeContext): ReviewApi {
  return {
    onEnqueueReview: async ({ repoOrId, agent, pr }) => {
      const normalized = resolvePath(repoOrId);
      const repo =
        findRepoByIdOrPath(rc.db, normalized) ??
        findRepoByIdOrPath(rc.db, repoOrId);

      if (!repo) {
        throw new Error(
          `Repository not found: ${repoOrId}. Use \`janitor add\` first.`,
        );
      }

      const sha = pr
        ? await resolvePrHeadShaAsync(repo.path, pr)
        : resolveHeadSha(repo.path);
      const subjectKey = pr
        ? prKey(pr, sha)
        : manualKey(String(Date.now()), sha);
      const enqueued = enqueueTriggerAndJob(rc.db, {
        repoId: repo.id,
        kind: 'manual',
        source: 'cli',
        subjectKey,
        payload: buildManualPayload(sha, agent, pr),
        maxAttempts: rc.config.scheduler.maxAttempts,
      });

      if (enqueued) {
        rc.scheduler.wake();
        const prLabel = pr ? ` PR #${pr}` : '';
        appendEvent(rc.db, {
          eventType: 'review.enqueued',
          repoId: repo.id,
          message: `Manual ${agent}${prLabel} review enqueued for ${sha.slice(0, 10)}`,
          level: 'info',
          payload: { sha, subjectKey, agent, ...(pr ? { pr } : {}) },
        });
      }

      return {
        ok: true as const,
        enqueued,
        repoId: repo.id,
        repoPath: repo.path,
        sha,
        subjectKey,
      };
    },
  };
}
