/**
 * Shared runtime context passed to hooks and runtime modules.
 *
 * Bundles the plugin input, exec bridge, mutable control state, and all
 * long-lived services so hook modules receive a single typed dependency
 * instead of loosely coupled closure variables.
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import type { CommitDetector } from '../git/commit-detector';
import type { PrContext } from '../git/pr-context-resolver';
import type { PrDetector } from '../git/pr-detector';
import type { HistoryStore } from '../history/store';
import type { ReviewRunQueue } from '../review/review-run-queue';
import type { RuntimeStateStore } from '../state/store';
import type { SuppressionStore } from '../suppressions/store';
import type { HunterResult, ReviewResult } from '../types';

/** Shell exec bridge — runs a command and returns stdout. */
export type Exec = (cmd: string) => Promise<string>;

/** Mutable pause/resume state for agents. */
export interface AgentControl {
  pausedJanitor: boolean;
  pausedHunter: boolean;
}

/** Runtime lifecycle flag. */
export interface RuntimeFlag {
  disposed: boolean;
}

/**
 * Full runtime context threaded through hooks and runtime modules.
 *
 * Created once during bootstrap and shared by reference.
 */
export interface RuntimeContext {
  ctx: PluginInput;
  config: JanitorConfig;
  exec: Exec;
  gitDir: string;
  stateDir: string;

  store: RuntimeStateStore;
  suppressionStore: SuppressionStore;
  historyStore: HistoryStore;

  orchestrator: ReviewRunQueue<string, ReviewResult>;
  hunterOrchestrator: ReviewRunQueue<PrContext, HunterResult>;

  detector: CommitDetector;
  prDetector: PrDetector | null;

  trackedSessions: Set<string>;
  control: AgentControl;
  runtime: RuntimeFlag;

  /** Whether gh CLI was available at startup */
  ghAvailableAtStartup: boolean;
  /** Whether a branch push was observed (for fallback PR detection) */
  branchPushPending: boolean;

  /** Agent trigger flags */
  janitorCommitEnabled: boolean;
  janitorPrEnabled: boolean;
  hunterCommitEnabled: boolean;
  hunterPrEnabled: boolean;
  anyCommitReviews: boolean;
  anyPrReviews: boolean;

  /** Write session metadata JSON alongside the JSONL event log. */
  writeSessionMeta: (
    sessionId: string,
    meta: {
      title: string;
      agent: string;
      key: string;
      status: string;
      startedAt: number;
      completedAt?: number;
    },
  ) => void;
}

/**
 * Create the exec bridge that pins git commands to the workspace directory.
 */
export function createExec(ctx: PluginInput): Exec {
  return async (cmd: string): Promise<string> => {
    const quoted = `'${ctx.directory.replace(/'/g, "'\\''")}'`;
    const pinned = cmd.startsWith('git ')
      ? `git -C ${quoted} ${cmd.slice(4)}`
      : cmd;
    const result = await ctx.$`${{ raw: pinned }}`.quiet().text();
    return result;
  };
}
