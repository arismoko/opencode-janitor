/**
 * Command hook — /janitor control surface.
 *
 * Subcommands:
 * - status: show pause state and job counts
 * - stop [janitor|hunter|all]: pause agent(s), drop pending, abort running
 * - resume [janitor|hunter|all]: unpause agent(s)
 * - clean: queue workspace review
 * - review [pr#]: queue PR/branch review
 */

import type { Part } from '@opencode-ai/sdk';
import { getWorkspaceCommitContext } from '../git/commit-resolver';
import { getPrByNumberFromGh, isGhAvailable } from '../git/gh-pr';
import {
  getPrContext,
  getWorkspacePrContext,
  type PrContext,
} from '../git/pr-context-resolver';
import type { CommandHookContext } from '../runtime/context';
import { injectMessage } from '../utils/notifier';
import { workspaceKey } from '../utils/review-key';

/**
 * Create the command.execute.before hook handler.
 */
export function createCommandHook(
  rc: CommandHookContext,
): (
  hookInput: { command: string; sessionID: string; arguments: string },
  _output: { parts: Part[] },
) => Promise<void> {
  return async (hookInput, _output) => {
    if (rc.runtime.disposed) return;
    if (hookInput.command !== 'janitor') return;

    // Workaround until opencode supports hook-level short-circuiting for
    // command.execute.before without throwing.
    const handled = (): never => {
      throw new Error('__handled__');
    };

    const args = hookInput.arguments.trim().split(/\s+/).filter(Boolean);
    const action = (args[0] ?? 'status').toLowerCase();
    const target = (args[1] ?? 'all').toLowerCase();
    const usage =
      'Usage: /janitor status | /janitor stop|resume [janitor|hunter|all] | /janitor clean | /janitor review [pr#]';

    const respond = async (text: string) =>
      injectMessage(rc.ctx, hookInput.sessionID, text, true);

    const renderJobs = () => {
      const janitorJobs = rc.janitorQueue.getJobsSnapshot();
      const hunterJobs = rc.hunterQueue.getJobsSnapshot();
      const janitorRunning = janitorJobs.filter((j) => j.status === 'running');
      const janitorPending = janitorJobs.filter((j) => j.status === 'pending');
      const hunterRunning = hunterJobs.filter((j) => j.status === 'running');
      const hunterPending = hunterJobs.filter((j) => j.status === 'pending');

      return [
        `paused: janitor=${rc.control.pausedJanitor}, hunter=${rc.control.pausedHunter}`,
        `jobs: janitor running=${janitorRunning.length}, pending=${janitorPending.length}; hunter running=${hunterRunning.length}, pending=${hunterPending.length}`,
        janitorRunning.length
          ? `janitor running: ${janitorRunning.map((j) => `${j.key} (${j.sessionId ?? 'starting'})`).join(', ')}`
          : 'janitor running: none',
        hunterRunning.length
          ? `hunter running: ${hunterRunning.map((j) => `${j.key} (${j.sessionId ?? 'starting'})`).join(', ')}`
          : 'hunter running: none',
      ].join('\n');
    };

    // -- Subcommand handlers --------------------------------------------------

    const targetJanitor = target === 'all' || target === 'janitor';
    const targetHunter = target === 'all' || target === 'hunter';

    const handleStatus = async () => {
      await respond(`📋 **[Janitor Control]**\n\n${renderJobs()}`);
    };

    const handleStop = async () => {
      if (!['all', 'janitor', 'hunter'].includes(target)) {
        await respond(usage);
        return;
      }
      if (targetJanitor) rc.control.pausedJanitor = true;
      if (targetHunter) rc.control.pausedHunter = true;
      rc.store.setPaused({
        janitor: rc.control.pausedJanitor,
        hunter: rc.control.pausedHunter,
      });

      let dropped = 0;
      let aborted = 0;
      if (targetJanitor) {
        dropped += rc.janitorQueue.clearPending();
        aborted += await rc.janitorQueue.abortRunning(rc.ctx);
      }
      if (targetHunter) {
        dropped += rc.hunterQueue.clearPending();
        aborted += await rc.hunterQueue.abortRunning(rc.ctx);
      }

      await respond(
        `🛑 **[Janitor Control]** stopped ${target}. dropped=${dropped}, aborted=${aborted}\n\n${renderJobs()}`,
      );
    };

    const handleResume = async () => {
      if (!['all', 'janitor', 'hunter'].includes(target)) {
        await respond(usage);
        return;
      }
      if (targetJanitor) rc.control.pausedJanitor = false;
      if (targetHunter) rc.control.pausedHunter = false;
      rc.store.setPaused({
        janitor: rc.control.pausedJanitor,
        hunter: rc.control.pausedHunter,
      });
      await respond(
        `▶️ **[Janitor Control]** resumed ${target}\n\n${renderJobs()}`,
      );
    };

    const handleClean = async () => {
      const branch = (await rc.exec('git rev-parse --abbrev-ref HEAD')).trim();
      const headSha = (await rc.exec('git rev-parse HEAD')).trim();
      if (!branch || branch === 'HEAD' || !headSha) {
        await respond(
          '⚠️ **[Janitor Control]** clean requires a checked-out branch and a valid HEAD',
        );
        return;
      }
      const workspace = await getWorkspaceCommitContext(rc.config, rc.exec);
      if (!workspace.patch.trim() && workspace.changedFiles.length === 0) {
        await respond(
          '🧼 **[Janitor Control]** clean: no workspace changes to review',
        );
        return;
      }
      const runKey = workspaceKey(branch, headSha);
      rc.janitorQueue.enqueue(runKey, hookInput.sessionID);
      await respond(`🧼 **[Janitor Control]** clean queued: ${runKey}`);
    };

    const handleReview = async () => {
      let prContext: PrContext | null = null;
      const prArg = args[1];

      if (prArg) {
        if (!/^\d+$/.test(prArg)) {
          await respond(
            '⚠️ **[Janitor Control]** review expects optional numeric PR number, e.g. `/janitor review 123`',
          );
          return;
        }
        const prNumber = Number(prArg);
        if (!(await isGhAvailable(rc.exec))) {
          await respond(
            '⚠️ **[Janitor Control]** review PR requires gh CLI availability',
          );
          return;
        }
        const ghPr = await getPrByNumberFromGh(rc.exec, prNumber);
        if (!ghPr) {
          await respond(
            `⚠️ **[Janitor Control]** review: PR #${prNumber} not found or not open`,
          );
          return;
        }
        prContext = await getPrContext({
          baseRef: ghPr.baseRef,
          headRef: ghPr.headRef,
          headSha: ghPr.headSha,
          number: ghPr.number,
          config: rc.config,
          exec: rc.exec,
        });
      } else {
        prContext = await getWorkspacePrContext(rc.config, rc.exec);
      }

      if (!prContext) {
        await respond(
          '⚠️ **[Janitor Control]** review requires a checked-out branch and valid repo state',
        );
        return;
      }

      if (!prContext.patch.trim() && prContext.changedFiles.length === 0) {
        await respond('🔍 **[Janitor Control]** review: no changes to review');
        return;
      }

      if (rc.hunterQueue.hasHeadInFlight(prContext.headSha)) {
        await respond(
          `🔍 **[Janitor Control]** review skipped: in-flight ${prContext.headSha.slice(0, 8)}`,
        );
        return;
      }

      rc.hunterQueue.enqueue(prContext, hookInput.sessionID);
      await respond(`🔍 **[Janitor Control]** review queued: ${prContext.key}`);
    };

    const handlers: Record<string, () => Promise<void>> = {
      status: handleStatus,
      stop: handleStop,
      resume: handleResume,
      clean: handleClean,
      review: handleReview,
    };

    const handler = handlers[action];
    if (handler) {
      await handler();
    } else {
      await respond(usage);
    }
    handled();
  };
}
