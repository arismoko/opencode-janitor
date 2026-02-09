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

import { getWorkspaceCommitContext } from '../git/commit-resolver';
import { getPrByNumberFromGh, isGhAvailable } from '../git/gh-pr';
import {
  getPrContext,
  getWorkspacePrContext,
  type PrContext,
} from '../git/pr-context-resolver';
import type { RuntimeContext } from '../runtime/context';
import { injectMessage } from '../utils/notifier';
import { extractHeadSha, workspaceKey } from '../utils/review-key';

/**
 * Create the command.execute.before hook handler.
 */
export function createCommandHook(
  rc: RuntimeContext,
): (
  hookInput: { command: string; sessionID: string; arguments: string },
  _output: { parts: Array<{ type: string; text?: string }> },
) => Promise<void> {
  /** Check if a hunter review is already in-flight for a given head SHA. */
  const hasHunterHeadInFlight = (headSha: string): boolean => {
    return rc.hunterOrchestrator.getJobsSnapshot().some((job) => {
      if (
        job.status !== 'pending' &&
        job.status !== 'starting' &&
        job.status !== 'running'
      ) {
        return false;
      }
      return extractHeadSha(job.key) === headSha;
    });
  };

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
      const janitorJobs = rc.orchestrator.getJobsSnapshot();
      const hunterJobs = rc.hunterOrchestrator.getJobsSnapshot();
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

    if (action === 'status') {
      await respond(`📋 **[Janitor Control]**\n\n${renderJobs()}`);
      handled();
    }

    if (!['stop', 'resume', 'clean', 'review'].includes(action)) {
      await respond(usage);
      handled();
    }

    const targetJanitor = target === 'all' || target === 'janitor';
    const targetHunter = target === 'all' || target === 'hunter';

    if (
      (action === 'stop' || action === 'resume') &&
      !['all', 'janitor', 'hunter'].includes(target)
    ) {
      await respond(usage);
      handled();
    }

    if (action === 'stop') {
      if (targetJanitor) rc.control.pausedJanitor = true;
      if (targetHunter) rc.control.pausedHunter = true;
      rc.store.setPaused({
        janitor: rc.control.pausedJanitor,
        hunter: rc.control.pausedHunter,
      });

      let dropped = 0;
      let aborted = 0;
      if (targetJanitor) {
        dropped += rc.orchestrator.clearPending();
        aborted += await rc.orchestrator.abortRunning(rc.ctx);
      }
      if (targetHunter) {
        dropped += rc.hunterOrchestrator.clearPending();
        aborted += await rc.hunterOrchestrator.abortRunning(rc.ctx);
      }

      await respond(
        `🛑 **[Janitor Control]** stopped ${target}. dropped=${dropped}, aborted=${aborted}\n\n${renderJobs()}`,
      );
      handled();
    }

    if (action === 'resume') {
      if (targetJanitor) rc.control.pausedJanitor = false;
      if (targetHunter) rc.control.pausedHunter = false;
      rc.store.setPaused({
        janitor: rc.control.pausedJanitor,
        hunter: rc.control.pausedHunter,
      });
      await respond(
        `▶️ **[Janitor Control]** resumed ${target}\n\n${renderJobs()}`,
      );
      handled();
    }

    if (action === 'clean') {
      const branch = (await rc.exec('git rev-parse --abbrev-ref HEAD')).trim();
      const headSha = (await rc.exec('git rev-parse HEAD')).trim();
      if (!branch || branch === 'HEAD' || !headSha) {
        await respond(
          '⚠️ **[Janitor Control]** clean requires a checked-out branch and a valid HEAD',
        );
        handled();
      }
      const workspace = await getWorkspaceCommitContext(rc.config, rc.exec);
      if (!workspace.patch.trim() && workspace.changedFiles.length === 0) {
        await respond(
          '🧼 **[Janitor Control]** clean: no workspace changes to review',
        );
        handled();
      }
      const runKey = workspaceKey(branch, headSha);
      rc.orchestrator.enqueue(runKey, hookInput.sessionID);
      await respond(`🧼 **[Janitor Control]** clean queued: ${runKey}`);
      handled();
    }

    if (action === 'review') {
      let prContext: PrContext | null = null;
      const prArg = args[1];

      if (prArg) {
        if (!/^\d+$/.test(prArg)) {
          await respond(
            '⚠️ **[Janitor Control]** review expects optional numeric PR number, e.g. `/janitor review 123`',
          );
          handled();
        }
        const prNumber = Number(prArg);
        if (!(await isGhAvailable(rc.exec))) {
          await respond(
            '⚠️ **[Janitor Control]** review PR requires gh CLI availability',
          );
          handled();
        }
        const ghPr = await getPrByNumberFromGh(rc.exec, prNumber);
        if (!ghPr) {
          await respond(
            `⚠️ **[Janitor Control]** review: PR #${prNumber} not found or not open`,
          );
          handled();
        }
        const selectedPr = ghPr!;
        prContext = await getPrContext({
          baseRef: selectedPr.baseRef,
          headRef: selectedPr.headRef,
          headSha: selectedPr.headSha,
          number: selectedPr.number,
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
        handled();
      }

      const reviewContext = prContext!;

      if (
        !reviewContext.patch.trim() &&
        reviewContext.changedFiles.length === 0
      ) {
        await respond('🔍 **[Janitor Control]** review: no changes to review');
        handled();
      }

      if (hasHunterHeadInFlight(reviewContext.headSha)) {
        await respond(
          `🔍 **[Janitor Control]** review skipped: in-flight ${reviewContext.headSha.slice(0, 8)}`,
        );
        handled();
      }

      rc.hunterOrchestrator.enqueue(reviewContext, hookInput.sessionID);
      await respond(
        `🔍 **[Janitor Control]** review queued: ${reviewContext.key}`,
      );
      handled();
    }

    await respond(usage);
    handled();
  };
}
