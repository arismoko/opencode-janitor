/**
 * Command hook — per-agent control surface.
 *
 * Commands:
 * - /janitor run|status|stop|resume — janitor agent control
 * - /hunter run [pr#]|status|stop|resume — hunter agent control
 * - /inspector run|status — inspector agent (not yet wired)
 * - /scribe run|status — scribe agent (not yet wired)
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

    // Cross-agent status renderer (shown by /janitor status as plugin overview)
    const renderAllStatus = () => {
      const janitorJobs = rc.janitorQueue.getJobsSnapshot();
      const hunterJobs = rc.hunterQueue.getJobsSnapshot();
      const jRunning = janitorJobs.filter((j) => j.status === 'running');
      const jPending = janitorJobs.filter((j) => j.status === 'pending');
      const hRunning = hunterJobs.filter((j) => j.status === 'running');
      const hPending = hunterJobs.filter((j) => j.status === 'pending');

      return [
        `**janitor** ${rc.control.pausedJanitor ? '⏸ paused' : '▶ active'} — running=${jRunning.length}, pending=${jPending.length}`,
        `**hunter** ${rc.control.pausedHunter ? '⏸ paused' : '▶ active'} — running=${hRunning.length}, pending=${hPending.length}`,
        `**inspector** — not yet wired`,
        `**scribe** — not yet wired`,
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
        rc.store.setPaused({
          janitor: true,
          hunter: rc.control.pausedHunter,
        });
        const dropped = rc.janitorQueue.clearPending();
        const aborted = await rc.janitorQueue.abortRunning(rc.ctx);
        await respond(
          `🛑 **[janitor]** stopped. dropped=${dropped}, aborted=${aborted}`,
        );
      } else if (action === 'resume') {
        rc.control.pausedJanitor = false;
        rc.store.setPaused({
          janitor: false,
          hunter: rc.control.pausedHunter,
        });
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
        rc.store.setPaused({
          janitor: rc.control.pausedJanitor,
          hunter: true,
        });
        const dropped = rc.hunterQueue.clearPending();
        const aborted = await rc.hunterQueue.abortRunning(rc.ctx);
        await respond(
          `🛑 **[hunter]** stopped. dropped=${dropped}, aborted=${aborted}`,
        );
      } else if (action === 'resume') {
        rc.control.pausedHunter = false;
        rc.store.setPaused({
          janitor: rc.control.pausedJanitor,
          hunter: false,
        });
        await respond(`▶️ **[hunter]** resumed`);
      } else {
        await respond(usage);
      }
      handled();
      return;
    }

    // --- /inspector (not yet wired) ---
    if (hookInput.command === 'inspector') {
      await respond(
        '⚠️ **[inspector]** not yet implemented — coming in a future commit',
      );
      handled();
      return;
    }

    // --- /scribe (not yet wired) ---
    if (hookInput.command === 'scribe') {
      await respond(
        '⚠️ **[scribe]** not yet implemented — coming in a future commit',
      );
      handled();
      return;
    }
  };
}
