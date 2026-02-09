/**
 * Agent runtime registry — pluggable spec registration and lookup.
 *
 * Agents register their AgentRuntimeSpec during bootstrap. The runtime
 * consumes the registry to build queues and executors, making new agents
 * additive instead of requiring edits to runtime composition code.
 */

import type { AgentRuntimeSpec } from './agent-runtime-spec';

export class AgentRuntimeRegistry {
  private specs = new Map<string, AgentRuntimeSpec<unknown>>();

  /** Register a spec. Throws if the agent name is already registered. */
  register<TContext>(spec: AgentRuntimeSpec<TContext>): void {
    if (this.specs.has(spec.agent)) {
      throw new Error(`Agent '${spec.agent}' is already registered`);
    }
    this.specs.set(spec.agent, spec as AgentRuntimeSpec<unknown>);
  }

  /** Look up a spec by agent name. Throws if not found. */
  get<TContext>(agent: string): AgentRuntimeSpec<TContext> {
    const spec = this.specs.get(agent);
    if (!spec) {
      throw new Error(`Agent '${agent}' is not registered`);
    }
    return spec as AgentRuntimeSpec<TContext>;
  }

  /** Check if an agent is registered. */
  has(agent: string): boolean {
    return this.specs.has(agent);
  }

  /** Get all registered agent names. */
  agents(): string[] {
    return [...this.specs.keys()];
  }
}
