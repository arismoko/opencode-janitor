/**
 * Agent registry — registers janitor + hunter agents and per-agent slash
 * commands (/janitor, /hunter, /inspector, /scribe) in OpenCode's config hook.
 *
 * Extracted from the inline `config` hook in `src/index.ts`. The returned
 * callback mutates the OpenCode config object in place (return value of
 * the config hook is ignored by the plugin system).
 */

import type { Config } from '@opencode-ai/sdk';
import { log } from '../utils/logger';

export interface AgentDefinition {
  name: string;
  description: string;
  config: Record<string, unknown>;
}

/**
 * Build a config-hook callback that registers the given agents and per-agent
 * slash commands in OpenCode's configuration.
 */
export function registerAgents(
  agents: AgentDefinition[],
): (opencodeConfig: Config) => Promise<void> {
  return async (opencodeConfig: Config) => {
    const agentRegistry = opencodeConfig.agent ?? {};

    for (const agent of agents) {
      agentRegistry[agent.name] = {
        ...agent.config,
        description: agent.description,
      };
    }

    const commands = opencodeConfig.command ?? {};
    commands.janitor = {
      description: 'Janitor agent: /janitor run | status | stop | resume',
      template: '',
    };
    commands.hunter = {
      description: 'Hunter agent: /hunter run [pr#] | status | stop | resume',
      template: '',
    };
    commands.inspector = {
      description: 'Inspector agent: /inspector run | status (coming soon)',
      template: '',
    };
    commands.scribe = {
      description: 'Scribe agent: /scribe run | status (coming soon)',
      template: '',
    };
    opencodeConfig.command = commands;
    opencodeConfig.agent = agentRegistry;

    log(
      "registered agents 'janitor' and 'bug-hunter'; commands /janitor, /hunter, /inspector, /scribe",
    );
  };
}
