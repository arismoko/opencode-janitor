/**
 * Agent runtime registry — plugin-style registry for agent runtime specs.
 *
 * Typed map of AgentName → AgentRuntimeSpec. Provides register/get/agents
 * operations for the scheduler to iterate over enabled agents.
 */
import type { AgentName } from '@opencode-janitor/shared';
import type { AgentRuntimeSpec } from './agent-runtime-spec';

// ---------------------------------------------------------------------------
// Registry interface
// ---------------------------------------------------------------------------

export interface AgentRuntimeRegistry {
  /** Register a spec. Throws if the agent name is already registered. */
  register(spec: AgentRuntimeSpec): void;

  /** Get a spec by agent name. Returns undefined if not registered. */
  get(name: AgentName): AgentRuntimeSpec | undefined;

  /** Return all registered specs. */
  agents(): AgentRuntimeSpec[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create an empty, mutable agent registry. */
export function createAgentRuntimeRegistry(): AgentRuntimeRegistry {
  const map = new Map<AgentName, AgentRuntimeSpec>();

  return {
    register(spec) {
      if (map.has(spec.agent)) {
        throw new Error(
          `Agent "${spec.agent}" is already registered in the runtime registry`,
        );
      }
      map.set(spec.agent, spec);
    },

    get(name) {
      return map.get(name);
    },

    agents() {
      return [...map.values()];
    },
  };
}
