import { describe, expect, it } from 'bun:test';
import {
  AGENT_IDS,
  AGENTS,
  type AgentId,
  TRIGGER_IDS,
} from '@opencode-janitor/shared';
import { CliConfigSchema } from '../config/schema';
import {
  canAgentPlanForEvent,
  canAgentRunForTrigger,
} from './agent-eligibility-policy';
import { createAgentSpecFromDefinition } from './agent-spec-from-definition';

const firstAgent = AGENT_IDS[0];
const secondAgent = AGENT_IDS[1] ?? AGENT_IDS[0];
const thirdAgent = AGENT_IDS[2] ?? AGENT_IDS[0];
const fourthAgent = AGENT_IDS[3] ?? AGENT_IDS[0];

const commitDefaultAgent = AGENT_IDS.find(
  (agent) => AGENTS[agent].defaults.autoTriggers[0] === 'commit',
);

if (!commitDefaultAgent) {
  throw new Error('Expected an agent with commit as default auto trigger.');
}

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
        [commitDefaultAgent]: { enabled: false },
      },
    });

    expect(canAgentRunForTrigger(config, commitDefaultAgent, 'commit')).toEqual(
      {
        eligible: false,
        reason: 'agent_disabled',
      },
    );
    expect(canAgentRunForTrigger(config, commitDefaultAgent, 'manual')).toEqual(
      {
        eligible: false,
        reason: 'agent_disabled',
      },
    );
  });

  it('enforces config and capability gates for auto triggers', () => {
    const config = CliConfigSchema.parse({
      agents: {
        [commitDefaultAgent]: { autoTriggers: ['pr'] },
      },
    });

    expect(canAgentRunForTrigger(config, commitDefaultAgent, 'commit')).toEqual(
      {
        eligible: false,
        reason: 'trigger_not_enabled_in_config',
      },
    );
    expect(canAgentRunForTrigger(config, commitDefaultAgent, 'pr')).toEqual({
      eligible: true,
    });
  });

  it('allows manual by default for enabled agents', () => {
    const config = CliConfigSchema.parse({});
    expect(canAgentRunForTrigger(config, secondAgent, 'manual')).toEqual({
      eligible: true,
    });
  });

  it('disables manual trigger when config flag is off', () => {
    const config = CliConfigSchema.parse({
      triggers: { manual: { enabled: false } },
    });
    expect(canAgentRunForTrigger(config, secondAgent, 'manual')).toEqual({
      eligible: false,
      reason: 'trigger_disabled',
    });
  });

  it('enforces manual target-agent filtering for planning', () => {
    const config = CliConfigSchema.parse({});

    expect(
      canAgentPlanForEvent(config, secondAgent, 'manual', {
        agent: secondAgent,
      }),
    ).toEqual({ eligible: true });
    expect(
      canAgentPlanForEvent(config, firstAgent, 'manual', {
        agent: secondAgent,
      }),
    ).toEqual({ eligible: false, reason: 'manual_target_mismatch' });
  });

  it('keeps planning behavior aligned with run eligibility for auto triggers', () => {
    const config = CliConfigSchema.parse({
      agents: {
        [secondAgent]: { autoTriggers: ['commit'] },
      },
    });

    const run = canAgentRunForTrigger(config, secondAgent, 'commit');
    const plan = canAgentPlanForEvent(config, secondAgent, 'commit', {});
    expect(plan).toEqual(run);
  });

  it('keeps planner policy and spec.supportsTrigger aligned across agent/trigger matrix', () => {
    const fixtures = [
      CliConfigSchema.parse({}),
      CliConfigSchema.parse({
        agents: {
          [firstAgent]: { enabled: false },
          [secondAgent]: { autoTriggers: ['commit'] },
          [thirdAgent]: { autoTriggers: [] },
          [fourthAgent]: { autoTriggers: ['pr'] },
        },
      }),
      CliConfigSchema.parse({
        agents: {
          [firstAgent]: { autoTriggers: ['commit', 'pr'] },
          [secondAgent]: { enabled: false },
          [thirdAgent]: { autoTriggers: ['commit', 'pr'] },
          [fourthAgent]: { autoTriggers: [] },
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
