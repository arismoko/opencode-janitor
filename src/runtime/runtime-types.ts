/**
 * Shared runtime primitive types — leaf module with no internal imports.
 *
 * These types are used by context slices and runtime modules. They live
 * here (not in context.ts) to avoid circular dependencies where child
 * slices would need to import from the parent that composes them.
 */

/** Shell exec bridge — runs a command and returns stdout. */
export type Exec = (cmd: string) => Promise<string>;

/** Canonical agent name union. */
export type AgentName = 'janitor' | 'hunter' | 'inspector' | 'scribe';

/** Mutable pause/resume state for agents. */
export interface AgentControl {
  paused: Record<AgentName, boolean>;
}

/** Runtime lifecycle flag. */
export interface RuntimeFlag {
  disposed: boolean;
}
