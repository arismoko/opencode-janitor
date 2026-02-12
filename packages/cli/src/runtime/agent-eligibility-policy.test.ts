import { describe, expect, it } from 'bun:test';
import { AGENT_IDS, type AgentId, TRIGGER_IDS } from '@opencode-janitor/shared';
import { CliConfigSchema } from '../config/schema';
import {
  canAgentPlanForEvent,
  canAgentRunForTrigger,
} from './agent-eligibility-policy';
import { createAgentSpecFromDefinition } from './agent-spec-from-definition';

function makeSpec(agent: AgentId) {
  return createAgentSpecFromDefinition({
    agent,
    buildPreparedContext: () => {
      throw new Error('not used in supportsTrigger tests');
    },
  });
}

describe('agent eligibility policy', () => {
  it('rejects disabled agents for auto and manual triggers', () => {
    const config = CliConfigSchema.parse({
      agents: {
        janitor: { enabled: false },
      },
    });

    expect(canAgentRunForTrigger(config, 'janitor', 'commit')).toEqual({
      eligible: false,
      reason: 'agent_disabled',
    });
    expect(canAgentRunForTrigger(config, 'janitor', 'manual')).toEqual({
      eligible: false,
      reason: 'agent_disabled',
    });
  });

  it('enforces config and capability gates for auto triggers', () => {
    const config = CliConfigSchema.parse({
      agents: {
        janitor: { autoTriggers: ['pr'] },
      },
    });

    expect(canAgentRunForTrigger(config, 'janitor', 'commit')).toEqual({
      eligible: false,
      reason: 'trigger_not_enabled_in_config',
    });
    expect(canAgentRunForTrigger(config, 'janitor', 'pr')).toEqual({
      eligible: true,
    });
  });

  it('allows manual by default for enabled agents', () => {
    const config = CliConfigSchema.parse({});
    expect(canAgentRunForTrigger(config, 'hunter', 'manual')).toEqual({
      eligible: true,
    });
  });

  it('enforces manual target-agent filtering for planning', () => {
    const config = CliConfigSchema.parse({});

    expect(
      canAgentPlanForEvent(config, 'hunter', 'manual', { agent: 'hunter' }),
    ).toEqual({ eligible: true });
    expect(
      canAgentPlanForEvent(config, 'janitor', 'manual', { agent: 'hunter' }),
    ).toEqual({ eligible: false, reason: 'manual_target_mismatch' });
  });

  it('keeps planning behavior aligned with run eligibility for auto triggers', () => {
    const config = CliConfigSchema.parse({
      agents: {
        hunter: { autoTriggers: ['commit'] },
      },
    });

    const run = canAgentRunForTrigger(config, 'hunter', 'commit');
    const plan = canAgentPlanForEvent(config, 'hunter', 'commit', {});
    expect(plan).toEqual(run);
  });

  it('keeps planner policy and spec.supportsTrigger aligned across agent/trigger matrix', () => {
    const fixtures = [
      CliConfigSchema.parse({}),
      CliConfigSchema.parse({
        agents: {
          janitor: { enabled: false },
          hunter: { autoTriggers: ['commit'] },
          inspector: { autoTriggers: [] },
          scribe: { autoTriggers: ['pr'] },
        },
      }),
      CliConfigSchema.parse({
        agents: {
          janitor: { autoTriggers: ['commit', 'pr'] },
          hunter: { enabled: false },
          inspector: { autoTriggers: ['commit', 'pr'] },
          scribe: { autoTriggers: [] },
        },
      }),
    ];

    const specs = Object.fromEntries(
      AGENT_IDS.map((agent) => [agent, makeSpec(agent)]),
    ) as Record<AgentId, ReturnType<typeof makeSpec>>;

    for (const config of fixtures) {
      for (const agent of AGENT_IDS) {
        for (const trigger of TRIGGER_IDS) {
          const policy = canAgentRunForTrigger(config, agent, trigger).eligible;
          const runtime = specs[agent].supportsTrigger(config, trigger);
          expect(runtime).toBe(policy);
        }
      }
    }
  });
});
