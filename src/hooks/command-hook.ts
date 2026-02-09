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
import type { ReviewRunQueue } from '../review/review-run-queue';
import type { CommandHookContext } from '../runtime/context';
import type { AgentControl, AgentName } from '../runtime/runtime-types';
import { workspaceKey } from '../utils/review-key';

// ---------------------------------------------------------------------------
// Agent queue / control descriptor — passed to shared helpers
// ---------------------------------------------------------------------------

interface AgentRef {
  name: AgentName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queue: ReviewRunQueue<any, any>;
}

// ---------------------------------------------------------------------------
// Shared helpers for stop / resume / status
// ---------------------------------------------------------------------------

/** Render a single-agent status line (used in both overview and per-agent). */
function renderAgentStatusLine(
  control: AgentControl,
  { name, queue }: AgentRef,
): string {
  const jobs = queue.getJobsSnapshot();
  const running = jobs.filter((j) => j.status === 'running');
  const pending = jobs.filter((j) => j.status === 'pending');
  const paused = control.paused[name];
  return `**${name}** ${paused ? '⏸ paused' : '▶ active'} — running=${running.length}, pending=${pending.length}`;
}

/** Render detailed single-agent status (includes running job keys). */
function renderDetailedStatus(control: AgentControl, ref: AgentRef): string {
  const jobs = ref.queue.getJobsSnapshot();
  const running = jobs.filter((j) => j.status === 'running');
  const line = `📋 **[${ref.name}]** ${renderAgentStatusLine(control, ref).replace(`**${ref.name}** `, '')}`;
  if (!running.length) return line;
  return `${line}\nrunning: ${running.map((j) => `${j.key} (${j.sessionId ?? 'starting'})`).join(', ')}`;
}

/**
 * Create the command.execute.before hook handler.
 */
export function createCommandHook(
  rc: CommandHookContext,
): (
  hookInput: { command: string; sessionID: string; arguments: string },
  output: { parts: Part[] },
) => Promise<void> {
  const agentCommands = new Set(['janitor', 'hunter', 'inspector', 'scribe']);

  // Reusable agent refs
  const agents: Record<AgentName, AgentRef> = {
    janitor: { name: 'janitor', queue: rc.janitorQueue },
    hunter: { name: 'hunter', queue: rc.hunterQueue },
    inspector: { name: 'inspector', queue: rc.inspectorQueue },
    scribe: { name: 'scribe', queue: rc.scribeQueue },
  };
  const allAgentRefs = Object.values(agents);

  return async (hookInput, output) => {
    if (rc.runtime.disposed) return;
    if (!agentCommands.has(hookInput.command)) return;

    const args = hookInput.arguments.trim().split(/\s+/).filter(Boolean);
    const action = (args[0] ?? 'status').toLowerCase();

    /**
     * Signal to the host that this command is handled by pushing a TextPart
     * into output.parts. The host short-circuits when parts.length > 0,
     * creating an assistant message from the parts instead of running the
     * default command expansion.
     */
    const respond = (text: string) => {
      output.parts.push({
        type: 'text',
        text,
      } as Part);
    };

    /** Persist current control pause state to store. */
    const persistPaused = () => rc.store.setPaused(rc.control.paused);

    /** Shared stop handler. */
    const handleStop = async (ref: AgentRef) => {
      rc.control.paused[ref.name] = true;
      persistPaused();
      const dropped = ref.queue.clearPending();
      const aborted = await ref.queue.abortRunning(rc.ctx);
      respond(
        `🛑 **[${ref.name}]** stopped. dropped=${dropped}, aborted=${aborted}`,
      );
    };

    /** Shared resume handler. */
    const handleResume = (ref: AgentRef) => {
      rc.control.paused[ref.name] = false;
      persistPaused();
      respond(`▶️ **[${ref.name}]** resumed`);
    };

    // Cross-agent status renderer (shown by /janitor status as plugin overview)
    const renderAllStatus = () =>
      allAgentRefs
        .map((ref) => renderAgentStatusLine(rc.control, ref))
        .join('\n');

    // --- /janitor ---
    if (hookInput.command === 'janitor') {
      const usage = 'Usage: /janitor run | status | stop | resume';

      if (action === 'status') {
        respond(`📋 **Agent Status**\n\n${renderAllStatus()}`);
      } else if (action === 'run') {
        const branch = (
          await rc.exec('git rev-parse --abbrev-ref HEAD')
        ).trim();
        const headSha = (await rc.exec('git rev-parse HEAD')).trim();
        if (!branch || branch === 'HEAD' || !headSha) {
          respond(
            '⚠️ **[janitor]** run requires a checked-out branch and a valid HEAD',
          );
          return;
        }
        const workspace = await getWorkspaceCommitContext(rc.config, rc.exec);
        if (!workspace.patch.trim() && workspace.changedFiles.length === 0) {
          respond('🧼 **[janitor]** no workspace changes to review');
          return;
        }
        const runKey = workspaceKey(branch, headSha);
        rc.janitorQueue.enqueue(runKey, hookInput.sessionID);
        respond(`🧼 **[janitor]** review queued: ${runKey}`);
      } else if (action === 'stop') {
        await handleStop(agents.janitor);
      } else if (action === 'resume') {
        handleResume(agents.janitor);
      } else {
        respond(usage);
      }
      return;
    }

    // --- /hunter ---
    if (hookInput.command === 'hunter') {
      const usage = 'Usage: /hunter run [pr#] | status | stop | resume';

      if (action === 'status') {
        respond(renderDetailedStatus(rc.control, agents.hunter));
      } else if (action === 'run') {
        let prContext: PrContext | null = null;
        const prArg = args[1];

        if (prArg) {
          if (!/^\d+$/.test(prArg)) {
            respond(
              '⚠️ **[hunter]** run expects optional numeric PR number, e.g. `/hunter run 123`',
            );
            return;
          }
          const prNumber = Number(prArg);
          if (!(await isGhAvailable(rc.exec))) {
            respond('⚠️ **[hunter]** run PR requires gh CLI availability');
            return;
          }
          const ghPr = await getPrByNumberFromGh(rc.exec, prNumber);
          if (!ghPr) {
            respond(
              `⚠️ **[hunter]** run: PR #${prNumber} not found or not open`,
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
          respond(
            '⚠️ **[hunter]** run requires a checked-out branch and valid repo state',
          );
          return;
        }

        if (!prContext.patch.trim() && prContext.changedFiles.length === 0) {
          respond('🔍 **[hunter]** run: no changes to review');
          return;
        }

        if (rc.hunterQueue.hasHeadInFlight(prContext.headSha)) {
          respond(
            `🔍 **[hunter]** run skipped: in-flight ${prContext.headSha.slice(0, 8)}`,
          );
          return;
        }

        rc.hunterQueue.enqueue(prContext, hookInput.sessionID);
        respond(`🔍 **[hunter]** review queued: ${prContext.key}`);
      } else if (action === 'stop') {
        await handleStop(agents.hunter);
      } else if (action === 'resume') {
        handleResume(agents.hunter);
      } else {
        respond(usage);
      }
      return;
    }

    // --- /inspector ---
    if (hookInput.command === 'inspector') {
      const usage = 'Usage: /inspector run | status | stop | resume';

      if (action === 'status') {
        respond(renderDetailedStatus(rc.control, agents.inspector));
      } else if (action === 'run') {
        const runKey = `inspector:${Date.now()}`;
        rc.inspectorQueue.enqueue(runKey, hookInput.sessionID);
        respond(`🔎 **[inspector]** repo-wide analysis queued: ${runKey}`);
      } else if (action === 'stop') {
        await handleStop(agents.inspector);
      } else if (action === 'resume') {
        handleResume(agents.inspector);
      } else {
        respond(usage);
      }
      return;
    }

    // --- /scribe ---
    if (hookInput.command === 'scribe') {
      const usage = 'Usage: /scribe run | status | stop | resume';

      if (action === 'status') {
        respond(renderDetailedStatus(rc.control, agents.scribe));
      } else if (action === 'run') {
        const runKey = `scribe:${Date.now()}`;
        rc.scribeQueue.enqueue(runKey, hookInput.sessionID);
        respond(`📝 **[scribe]** documentation audit queued: ${runKey}`);
      } else if (action === 'stop') {
        await handleStop(agents.scribe);
      } else if (action === 'resume') {
        handleResume(agents.scribe);
      } else {
        respond(usage);
      }
      return;
    }
  };
}
