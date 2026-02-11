import { describe, expect, it, mock } from 'bun:test';
import { AGENTS } from '@opencode-janitor/shared';
import { Command } from 'commander';
import {
  registerAgentCommandsFromRegistry,
  resolveScopeSelection,
} from './agent-command-factory';

describe('registerAgentCommandsFromRegistry', () => {
  it('registers one command per agent definition', () => {
    const program = new Command();
    registerAgentCommandsFromRegistry(program, async () => {});

    const names = program.commands.map((cmd) => cmd.name());
    for (const definition of Object.values(AGENTS)) {
      expect(names).toContain(definition.cli.command);
    }
  });

  it('dispatches hunter --pr as scope=pr with numeric input', async () => {
    const program = new Command();
    const handler = mock(async () => {});
    registerAgentCommandsFromRegistry(program, handler);

    await program.parseAsync(
      ['node', 'test', 'hunter', '/tmp/repo', '--pr', '42'],
      {
        from: 'node',
      },
    );

    expect(handler).toHaveBeenCalledWith({
      agent: 'hunter',
      repoArg: '/tmp/repo',
      scope: 'pr',
      input: { prNumber: 42 },
    });
  });
});

describe('resolveScopeSelection', () => {
  it('throws when scope input fails schema validation', () => {
    expect(() =>
      resolveScopeSelection('hunter', { pr: 'not-a-number' }),
    ).toThrow('Invalid input for scope pr');
  });
});
