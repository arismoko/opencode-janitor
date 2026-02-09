/**
 * Command hook — per-agent control surface.
 *
 * Commands:
 * - /janitor run|status|stop|resume — janitor agent control
 * - /hunter run [pr#]|status|stop|resume — hunter agent control
 * - /inspector run|status|stop|resume — inspector agent control (manual trigger)
 * - /scribe run|status|stop|resume — scribe agent control (manual trigger)
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
  const agentCommands = new Set(['janitor', 'hunter', 'inspector', 'scribe']);

  return async (hookInput, _output) => {
    if (rc.runtime.disposed) return;
    if (!agentCommands.has(hookInput.command)) return;

    // Workaround until opencode supports hook-level short-circuiting for
    // command.execute.before without throwing.
    const handled = (): never => {
      throw new Error('__handled__');
    };

    const args = hookInput.arguments.trim().split(/\s+/).filter(Boolean);
    const action = (args[0] ?? 'status').toLowerCase();

    const respond = async (text: string) =>
      injectMessage(rc.ctx, hookInput.sessionID, text, true);

    /** Persist current control pause state to store. */
    const persistPaused = () =>
      rc.store.setPaused({
        janitor: rc.control.pausedJanitor,
        hunter: rc.control.pausedHunter,
        inspector: rc.control.pausedInspector,
        scribe: rc.control.pausedScribe,
      });

    // Cross-agent status renderer (shown by /janitor status as plugin overview)
    const renderAllStatus = () => {
      const janitorJobs = rc.janitorQueue.getJobsSnapshot();
      const hunterJobs = rc.hunterQueue.getJobsSnapshot();
      const inspectorJobs = rc.inspectorQueue.getJobsSnapshot();
      const scribeJobs = rc.scribeQueue.getJobsSnapshot();
      const jRunning = janitorJobs.filter((j) => j.status === 'running');
      const jPending = janitorJobs.filter((j) => j.status === 'pending');
      const hRunning = hunterJobs.filter((j) => j.status === 'running');
      const hPending = hunterJobs.filter((j) => j.status === 'pending');
      const iRunning = inspectorJobs.filter((j) => j.status === 'running');
      const iPending = inspectorJobs.filter((j) => j.status === 'pending');
      const sRunning = scribeJobs.filter((j) => j.status === 'running');
      const sPending = scribeJobs.filter((j) => j.status === 'pending');

      return [
        `**janitor** ${rc.control.pausedJanitor ? '⏸ paused' : '▶ active'} — running=${jRunning.length}, pending=${jPending.length}`,
        `**hunter** ${rc.control.pausedHunter ? '⏸ paused' : '▶ active'} — running=${hRunning.length}, pending=${hPending.length}`,
        `**inspector** ${rc.control.pausedInspector ? '⏸ paused' : '▶ active'} — running=${iRunning.length}, pending=${iPending.length}`,
        `**scribe** ${rc.control.pausedScribe ? '⏸ paused' : '▶ active'} — running=${sRunning.length}, pending=${sPending.length}`,
      ].join('\n');
    };

    // --- /janitor ---
    if (hookInput.command === 'janitor') {
      const usage = 'Usage: /janitor run | status | stop | resume';

      if (action === 'status') {
        await respond(`📋 **Agent Status**\n\n${renderAllStatus()}`);
      } else if (action === 'run') {
        const branch = (
          await rc.exec('git rev-parse --abbrev-ref HEAD')
        ).trim();
        const headSha = (await rc.exec('git rev-parse HEAD')).trim();
        if (!branch || branch === 'HEAD' || !headSha) {
          await respond(
            '⚠️ **[janitor]** run requires a checked-out branch and a valid HEAD',
          );
          handled();
          return;
        }
        const workspace = await getWorkspaceCommitContext(rc.config, rc.exec);
        if (!workspace.patch.trim() && workspace.changedFiles.length === 0) {
          await respond('🧼 **[janitor]** no workspace changes to review');
          handled();
          return;
        }
        const runKey = workspaceKey(branch, headSha);
        rc.janitorQueue.enqueue(runKey, hookInput.sessionID);
        await respond(`🧼 **[janitor]** review queued: ${runKey}`);
      } else if (action === 'stop') {
        rc.control.pausedJanitor = true;
        persistPaused();
        const dropped = rc.janitorQueue.clearPending();
        const aborted = await rc.janitorQueue.abortRunning(rc.ctx);
        await respond(
          `🛑 **[janitor]** stopped. dropped=${dropped}, aborted=${aborted}`,
        );
      } else if (action === 'resume') {
        rc.control.pausedJanitor = false;
        persistPaused();
        await respond(`▶️ **[janitor]** resumed`);
      } else {
        await respond(usage);
      }
      handled();
      return;
    }

    // --- /hunter ---
    if (hookInput.command === 'hunter') {
      const usage = 'Usage: /hunter run [pr#] | status | stop | resume';

      if (action === 'status') {
        const hunterJobs = rc.hunterQueue.getJobsSnapshot();
        const running = hunterJobs.filter((j) => j.status === 'running');
        const pending = hunterJobs.filter((j) => j.status === 'pending');
        await respond(
          `📋 **[hunter]** ${rc.control.pausedHunter ? '⏸ paused' : '▶ active'} — running=${running.length}, pending=${pending.length}` +
            (running.length
              ? `\nrunning: ${running.map((j) => `${j.key} (${j.sessionId ?? 'starting'})`).join(', ')}`
              : ''),
        );
      } else if (action === 'run') {
        let prContext: PrContext | null = null;
        const prArg = args[1];

        if (prArg) {
          if (!/^\d+$/.test(prArg)) {
            await respond(
              '⚠️ **[hunter]** run expects optional numeric PR number, e.g. `/hunter run 123`',
            );
            handled();
            return;
          }
          const prNumber = Number(prArg);
          if (!(await isGhAvailable(rc.exec))) {
            await respond('⚠️ **[hunter]** run PR requires gh CLI availability');
            handled();
            return;
          }
          const ghPr = await getPrByNumberFromGh(rc.exec, prNumber);
          if (!ghPr) {
            await respond(
              `⚠️ **[hunter]** run: PR #${prNumber} not found or not open`,
            );
            handled();
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
            '⚠️ **[hunter]** run requires a checked-out branch and valid repo state',
          );
          handled();
          return;
        }

        if (!prContext.patch.trim() && prContext.changedFiles.length === 0) {
          await respond('🔍 **[hunter]** run: no changes to review');
          handled();
          return;
        }

        if (rc.hunterQueue.hasHeadInFlight(prContext.headSha)) {
          await respond(
            `🔍 **[hunter]** run skipped: in-flight ${prContext.headSha.slice(0, 8)}`,
          );
          handled();
          return;
        }

        rc.hunterQueue.enqueue(prContext, hookInput.sessionID);
        await respond(`🔍 **[hunter]** review queued: ${prContext.key}`);
      } else if (action === 'stop') {
        rc.control.pausedHunter = true;
        persistPaused();
        const dropped = rc.hunterQueue.clearPending();
        const aborted = await rc.hunterQueue.abortRunning(rc.ctx);
        await respond(
          `🛑 **[hunter]** stopped. dropped=${dropped}, aborted=${aborted}`,
        );
      } else if (action === 'resume') {
        rc.control.pausedHunter = false;
        persistPaused();
        await respond(`▶️ **[hunter]** resumed`);
      } else {
        await respond(usage);
      }
      handled();
      return;
    }

    // --- /inspector ---
    if (hookInput.command === 'inspector') {
      const usage = 'Usage: /inspector run | status | stop | resume';

      if (action === 'status') {
        const inspectorJobs = rc.inspectorQueue.getJobsSnapshot();
        const running = inspectorJobs.filter((j) => j.status === 'running');
        const pending = inspectorJobs.filter((j) => j.status === 'pending');
        await respond(
          `📋 **[inspector]** ${rc.control.pausedInspector ? '⏸ paused' : '▶ active'} — running=${running.length}, pending=${pending.length}` +
            (running.length
              ? `\nrunning: ${running.map((j) => `${j.key} (${j.sessionId ?? 'starting'})`).join(', ')}`
              : ''),
        );
      } else if (action === 'run') {
        const runKey = `inspector:${Date.now()}`;
        rc.inspectorQueue.enqueue(runKey, hookInput.sessionID);
        await respond(
          `🔎 **[inspector]** repo-wide analysis queued: ${runKey}`,
        );
      } else if (action === 'stop') {
        rc.control.pausedInspector = true;
        persistPaused();
        const dropped = rc.inspectorQueue.clearPending();
        const aborted = await rc.inspectorQueue.abortRunning(rc.ctx);
        await respond(
          `🛑 **[inspector]** stopped. dropped=${dropped}, aborted=${aborted}`,
        );
      } else if (action === 'resume') {
        rc.control.pausedInspector = false;
        persistPaused();
        await respond(`▶️ **[inspector]** resumed`);
      } else {
        await respond(usage);
      }
      handled();
      return;
    }

    // --- /scribe ---
    if (hookInput.command === 'scribe') {
      const usage = 'Usage: /scribe run | status | stop | resume';

      if (action === 'status') {
        const scribeJobs = rc.scribeQueue.getJobsSnapshot();
        const running = scribeJobs.filter((j) => j.status === 'running');
        const pending = scribeJobs.filter((j) => j.status === 'pending');
        await respond(
          `📋 **[scribe]** ${rc.control.pausedScribe ? '⏸ paused' : '▶ active'} — running=${running.length}, pending=${pending.length}` +
            (running.length
              ? `\nrunning: ${running.map((j) => `${j.key} (${j.sessionId ?? 'starting'})`).join(', ')}`
              : ''),
        );
      } else if (action === 'run') {
        const runKey = `scribe:${Date.now()}`;
        rc.scribeQueue.enqueue(runKey, hookInput.sessionID);
        await respond(`📝 **[scribe]** documentation audit queued: ${runKey}`);
      } else if (action === 'stop') {
        rc.control.pausedScribe = true;
        persistPaused();
        const dropped = rc.scribeQueue.clearPending();
        const aborted = await rc.scribeQueue.abortRunning(rc.ctx);
        await respond(
          `🛑 **[scribe]** stopped. dropped=${dropped}, aborted=${aborted}`,
        );
      } else if (action === 'resume') {
        rc.control.pausedScribe = false;
        persistPaused();
        await respond(`▶️ **[scribe]** resumed`);
      } else {
        await respond(usage);
      }
      handled();
      return;
    }
  };
}
