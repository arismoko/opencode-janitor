import {
  AGENTS,
  type AgentName,
  SCOPES,
  type ScopeId,
} from '@opencode-janitor/shared';
import type { Command } from 'commander';

export interface AgentCommandInvocation {
  agent: AgentName;
  repoArg?: string;
  scope?: ScopeId;
  input?: Record<string, unknown>;
}

type ScopeOptionBinding = {
  scope: ScopeId;
  flag: string;
  optionName: string;
  key: string;
  description: string;
  required: boolean;
};

function optionNameFromFlag(flag: string): string {
  const match = flag.match(/--([a-zA-Z0-9-]+)/);
  if (!match?.[1]) {
    throw new Error(`Unable to infer option name from flag: ${flag}`);
  }

  return match[1].replace(/-([a-z])/g, (_full, char: string) =>
    char.toUpperCase(),
  );
}

function listScopeOptionBindings(agent: AgentName): ScopeOptionBinding[] {
  const bindings: ScopeOptionBinding[] = [];
  for (const scopeId of AGENTS[agent].capabilities.manualScopes) {
    const scope = SCOPES[scopeId];
    if (!scope.cliOptions) {
      continue;
    }

    for (const option of scope.cliOptions) {
      bindings.push({
        scope: scopeId,
        flag: option.flag,
        optionName: optionNameFromFlag(option.flag),
        key: option.key,
        description: option.description,
        required: option.required === true,
      });
    }
  }
  return bindings;
}

function coerceCliValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (/^[0-9]+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  return trimmed;
}

export function resolveScopeSelection(
  agent: AgentName,
  options: Record<string, unknown>,
): { scope?: ScopeId; input?: Record<string, unknown> } {
  const bindings = listScopeOptionBindings(agent);
  const selectedScopes = new Set<ScopeId>();

  for (const binding of bindings) {
    if (options[binding.optionName] !== undefined) {
      selectedScopes.add(binding.scope);
    }
  }

  if (selectedScopes.size === 0) {
    return {};
  }

  if (selectedScopes.size > 1) {
    throw new Error('Only one scope option group can be provided per command.');
  }

  const scope = [...selectedScopes][0]!;
  const scopeBindings = bindings.filter((binding) => binding.scope === scope);
  const input: Record<string, unknown> = {};

  for (const binding of scopeBindings) {
    const raw = options[binding.optionName];
    if (raw === undefined) {
      if (binding.required) {
        throw new Error(
          `Missing required option for scope ${scope}: ${binding.flag}`,
        );
      }
      continue;
    }
    input[binding.key] = coerceCliValue(raw);
  }

  const parsed = SCOPES[scope].inputSchema?.safeParse(input);
  if (parsed && !parsed.success) {
    throw new Error(
      `Invalid input for scope ${scope}: ${parsed.error.issues
        .map((issue) => issue.message)
        .join(', ')}`,
    );
  }

  return {
    scope,
    ...(Object.keys(input).length > 0 ? { input } : {}),
  };
}

export function registerAgentCommandsFromRegistry(
  program: Command,
  handler: (invocation: AgentCommandInvocation) => Promise<void>,
): void {
  for (const [agent, definition] of Object.entries(AGENTS) as [
    AgentName,
    (typeof AGENTS)[AgentName],
  ][]) {
    const command = program
      .command(`${definition.cli.command} [repo]`)
      .description(definition.cli.description);

    if (definition.cli.alias) {
      command.alias(definition.cli.alias);
    }

    const bindings = listScopeOptionBindings(agent);
    const seenFlags = new Set<string>();
    for (const binding of bindings) {
      if (seenFlags.has(binding.flag)) {
        continue;
      }
      seenFlags.add(binding.flag);
      command.option(binding.flag, binding.description);
    }

    command.action(async (repoArg: string | undefined, options: object) => {
      const manual = resolveScopeSelection(
        agent,
        options as Record<string, unknown>,
      );
      await handler({
        agent,
        repoArg,
        ...manual,
      });
    });
  }
}
