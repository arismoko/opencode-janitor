import { describe, expect, it, mock } from 'bun:test';
import { AGENT_IDS, AGENTS } from '@opencode-janitor/shared';
import { Command } from 'commander';
import {
  registerAgentCommandsFromRegistry,
  resolveScopeSelection,
} from './agent-command-factory';

const prCapableAgent = AGENT_IDS.find((agentId) =>
  AGENTS[agentId].capabilities.manualScopes.includes('pr'),
);

if (!prCapableAgent) {
  throw new Error('Expected an agent with pr manual scope support.');
}

describe('registerAgentCommandsFromRegistry', () => {
  it('registers one command per agent definition', () => {
    const program = new Command();
    registerAgentCommandsFromRegistry(program, async () => {});

    const names = program.commands.map((cmd) => cmd.name());
    for (const definition of Object.values(AGENTS)) {
      expect(names).toContain(definition.cli.command);
    }
  });

  it('dispatches pr-capable command with scope=pr and numeric input', async () => {
    const program = new Command();
    const handler = mock(async () => {});
    registerAgentCommandsFromRegistry(program, handler);

    await program.parseAsync(
      [
        'node',
        'test',
        AGENTS[prCapableAgent].cli.command,
        '/tmp/repo',
        '--pr',
        '42',
      ],
      {
        from: 'node',
      },
    );

    expect(handler).toHaveBeenCalledWith({
      agent: prCapableAgent,
      repoArg: '/tmp/repo',
      scope: 'pr',
      input: { prNumber: 42 },
    });
  });

  it('forwards --note and --focus options', async () => {
    const program = new Command();
    const handler = mock(async () => {});
    registerAgentCommandsFromRegistry(program, handler);

    await program.parseAsync(
      [
        'node',
        'test',
        AGENTS[prCapableAgent].cli.command,
        '/tmp/repo',
        '--note',
        'DO NOTHING JUST SAY HI :3',
        '--focus',
        'src/features/payments',
      ],
      {
        from: 'node',
      },
    );

    expect(handler).toHaveBeenCalledWith({
      agent: prCapableAgent,
      repoArg: '/tmp/repo',
      note: 'DO NOTHING JUST SAY HI :3',
      focusPath: 'src/features/payments',
    });
  });
});

describe('resolveScopeSelection', () => {
  it('throws when scope input fails schema validation', () => {
    expect(() =>
      resolveScopeSelection(prCapableAgent, { pr: 'not-a-number' }),
    ).toThrow('Invalid input for scope pr');
  });
});
