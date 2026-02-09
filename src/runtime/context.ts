/**
 * Shared runtime context passed to hooks and runtime modules.
 *
 * Bundles the plugin input, exec bridge, mutable control state, and all
 * long-lived services so hook modules receive a single typed dependency
 * instead of loosely coupled closure variables.
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { ConfigContext } from './context/config-context';
import type { GitContext } from './context/git-context';
import type { QueueContext } from './context/queue-context';
import type { SessionContext } from './context/session-context';

// Re-export slices for convenience
export type { ConfigContext, GitContext, QueueContext, SessionContext };

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
 * Full runtime context — composition boundary.
 * Created once during bootstrap and shared by reference.
 * Hooks should consume narrow projection types instead.
 */
export interface RuntimeContext
  extends ConfigContext,
    GitContext,
    QueueContext,
    SessionContext {}

// ---------------------------------------------------------------------------
// Consumer projections — minimum contracts for hook modules
// ---------------------------------------------------------------------------

/** Projection for event-hook: session lifecycle + dispatcher routing */
export type EventHookContext = Pick<
  RuntimeContext,
  'ctx' | 'config' | 'runtime' | 'trackedSessions' | 'stateDir' | 'dispatcher'
>;

/** Projection for tool-hook: detection acceleration */
export type ToolHookContext = Pick<
  RuntimeContext,
  | 'runtime'
  | 'anyCommitReviews'
  | 'detector'
  | 'prDetector'
  | 'config'
  | 'ghAvailableAtStartup'
  | 'branchPushPending'
>;

/** Projection for command-hook: full control surface */
export type CommandHookContext = Pick<
  RuntimeContext,
  | 'ctx'
  | 'config'
  | 'exec'
  | 'runtime'
  | 'control'
  | 'store'
  | 'janitorQueue'
  | 'hunterQueue'
>;

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
