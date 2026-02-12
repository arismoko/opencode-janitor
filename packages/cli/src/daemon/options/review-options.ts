import { resolve as resolvePath } from 'node:path';
import type { ScopeId } from '@opencode-janitor/shared';
import { appendEvent } from '../../db/queries/event-queries';
import { findRepoByIdOrPath } from '../../db/queries/repo-queries';
import { insertTriggerEvent } from '../../db/queries/trigger-event-queries';
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
    onEnqueueReview: async ({ repoOrId, agent, scope, input, note }) => {
      const normalized = resolvePath(repoOrId);
      const repo =
        findRepoByIdOrPath(rc.db, normalized) ??
        findRepoByIdOrPath(rc.db, repoOrId);

      if (!repo) {
        throw new Error(
          `Repository not found: ${repoOrId}. Use \`janitor add\` first.`,
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
  };
}
