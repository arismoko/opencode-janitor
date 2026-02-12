import { resolve as resolvePath } from 'node:path';
import type { ScopeId } from '@opencode-janitor/shared';
import { appendEvent } from '../../db/queries/event-queries';
import { findRepoByIdOrPath } from '../../db/queries/repo-queries';
import {
  getReviewRunById,
  markReviewRunCancelled,
  resumeReviewRunInPlace,
} from '../../db/queries/review-run-queries';
import { insertTriggerEvent } from '../../db/queries/trigger-event-queries';
import { abortSession } from '../../reviews/runner';
import type { RuntimeContext } from '../../runtime/context';
import { planReviewRunsForEvent } from '../../runtime/planner';
import { MANUAL_TRIGGER_MODULE } from '../../triggers/modules/manual';
import { resolveHeadSha, resolvePrHeadShaAsync } from '../../utils/git';
import { makeId } from '../../utils/ids';
import type { ReviewApi } from '../socket-types';

function parsePrNumber(input?: Record<string, unknown>): number | undefined {
  const raw = input?.prNumber;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    return undefined;
  }
  return raw;
}

function requirePrNumberForPrScope(
  scope: ScopeId | undefined,
  input?: Record<string, unknown>,
): number | undefined {
  if (scope !== 'pr') {
    return parsePrNumber(input);
  }

  const prNumber = parsePrNumber(input);
  if (!prNumber) {
    throw new Error(
      'Manual scope `pr` requires `input.prNumber` as a positive integer.',
    );
  }
  return prNumber;
}

export function createReviewOptions(rc: RuntimeContext): ReviewApi {
  return {
    onEnqueueReview: async ({
      repoOrId,
      agent,
      scope,
      input,
      note,
      focusPath,
    }) => {
      const normalized = resolvePath(repoOrId);
      const repo =
        findRepoByIdOrPath(rc.db, normalized) ??
        findRepoByIdOrPath(rc.db, repoOrId);

      if (!repo) {
        throw new Error(
          `Repository not found: ${repoOrId}. Use \`add\` first.`,
        );
      }

      const prNumber = requirePrNumberForPrScope(scope, input);
      const sha = prNumber
        ? await resolvePrHeadShaAsync(repo.path, prNumber)
        : resolveHeadSha(repo.path);

      const payload = await MANUAL_TRIGGER_MODULE.fromManualRequest({
        agent,
        scope,
        input,
        note,
        focusPath,
        sha,
        ...(prNumber ? { prNumber } : {}),
      });
      // fromManualRequest validates and maps scope→requestedScope via the
      // shared ManualTriggerPayloadSchema.  The result is already a valid
      // ManualJobPayload shape — merge the caller's `agent` (which is always
      // required at this level) to ensure it's present.
      const manualPayload = { ...payload, agent };
      const subject = MANUAL_TRIGGER_MODULE.buildSubject(manualPayload);

      const inserted = insertTriggerEvent(rc.db, {
        repoId: repo.id,
        triggerId: 'manual',
        eventKey: makeId('manual'),
        subject,
        payloadJson: JSON.stringify(manualPayload),
        source: 'cli',
        detectedAt: Date.now(),
      });
      const planned = planReviewRunsForEvent(
        rc.db,
        rc.config,
        inserted.eventId,
      );
      const enqueued = planned.planned > 0;

      if (enqueued) {
        rc.scheduler.wake();
        const prLabel = prNumber ? ` PR #${prNumber}` : '';
        appendEvent(rc.db, {
          eventType: 'review.enqueued',
          repoId: repo.id,
          message: `Manual ${agent}${prLabel} review enqueued for ${sha.slice(0, 10)}`,
          level: 'info',
          payload: {
            sha,
            subject,
            agent,
            ...(scope ? { scope } : {}),
            ...(input ? { input } : {}),
            ...(note ? { note } : {}),
            ...(focusPath ? { focusPath } : {}),
            ...(prNumber ? { prNumber } : {}),
          },
        });
      }

      return {
        ok: true as const,
        enqueued,
        repoId: repo.id,
        repoPath: repo.path,
        sha,
        subject,
      };
    },

    onStopReview: async ({ reviewRunId }) => {
      const run = getReviewRunById(rc.db, reviewRunId);
      if (!run) {
        return { ok: true as const, stopped: false, reviewRunId };
      }

      if (run.status === 'queued') {
        markReviewRunCancelled(
          rc.db,
          run.id,
          'REVIEW_STOPPED',
          'Stopped before execution',
        );
        appendEvent(rc.db, {
          eventType: 'review_run.cancelled',
          level: 'warn',
          repoId: run.repo_id,
          triggerEventId: run.trigger_event_id,
          reviewRunId: run.id,
          message: `Review run ${run.id} cancelled before execution`,
          payload: { reviewRunId: run.id, agent: run.agent },
        });
        return {
          ok: true as const,
          stopped: true,
          reviewRunId: run.id,
          status: 'cancelled' as const,
        };
      }

      if (run.status === 'running' && run.session_id) {
        const repo = findRepoByIdOrPath(rc.db, run.repo_id);
        rc.completionBus.cancel(run.session_id, 'review stop requested');
        if (repo) {
          await abortSession(rc.child.client, run.session_id, repo.path);
        }
        appendEvent(rc.db, {
          eventType: 'review_run.stop_requested',
          level: 'warn',
          repoId: run.repo_id,
          triggerEventId: run.trigger_event_id,
          reviewRunId: run.id,
          message: `Stop requested for review run ${run.id}`,
          payload: {
            reviewRunId: run.id,
            agent: run.agent,
            sessionId: run.session_id,
          },
        });
        return { ok: true as const, stopped: true, reviewRunId: run.id };
      }

      return { ok: true as const, stopped: false, reviewRunId: run.id };
    },

    onResumeReview: async ({ reviewRunId }) => {
      const run = getReviewRunById(rc.db, reviewRunId);
      if (!run || !run.session_id) {
        return {
          ok: true as const,
          resumed: false,
          reviewRunId,
          errorCode: 'NOT_RESUMABLE' as const,
        };
      }

      const resumed = resumeReviewRunInPlace(rc.db, reviewRunId);
      if (!resumed) {
        return {
          ok: true as const,
          resumed: false,
          reviewRunId,
          errorCode: 'NOT_RESUMABLE' as const,
        };
      }

      rc.scheduler.wake();
      appendEvent(rc.db, {
        eventType: 'review_run.resumed',
        level: 'info',
        repoId: run.repo_id,
        triggerEventId: run.trigger_event_id,
        reviewRunId: run.id,
        message: `Review run ${run.id} resumed in-place`,
        payload: {
          reviewRunId: run.id,
          agent: run.agent,
          sessionId: run.session_id,
        },
      });

      return {
        ok: true as const,
        resumed: true,
        reviewRunId: run.id,
        status: 'queued' as const,
      };
    },
  };
}
