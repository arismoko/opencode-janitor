/**
 * Shared runtime context — composition boundary + consumer projections.
 *
 * This module composes the context slices into RuntimeContext and defines
 * narrow Pick-based projections for each hook module. Primitive types
 * (Exec, AgentControl, RuntimeFlag) live in runtime-types.ts to avoid
 * circular imports between slices and this parent module.
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { ConfigContext } from './context/config-context';
import type { GitContext } from './context/git-context';
import type { QueueContext } from './context/queue-context';
import type { SessionContext } from './context/session-context';
import type { Exec } from './runtime-types';

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
