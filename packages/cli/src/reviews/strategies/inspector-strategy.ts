/**
 * Inspector strategy — builds review context for the Inspector agent.
 *
 * The Inspector focuses on structural complexity and design debt
 * (COMPLEXITY, DESIGN, SMELL). Primarily a manual trigger but supports
 * all trigger kinds.
 */

import type { AgentProfile } from '@opencode-janitor/shared';
import type {
  AgentRuntimeSpec,
  PrepareContextInput,
  PreparedAgentContext,
} from '../../runtime/agent-runtime-spec';
import {
  buildCommitPreparedContext,
  buildRepoPreparedContext,
  createAgentSpecFactory,
} from './base-agent-spec';

export function createInspectorSpec(profile: AgentProfile): AgentRuntimeSpec {
  return createAgentSpecFactory(
    profile,
    (input: PrepareContextInput, agentName): PreparedAgentContext => {
      const { config, trigger } = input;

      if (trigger.kind === 'manual') {
        return buildRepoPreparedContext(agentName, config, {
          label: 'Manual repo-wide analysis',
          metadata: ['Trigger: manual', 'Mode: full codebase inspection'],
          reason: 'manual-repo',
        });
      }

      return buildCommitPreparedContext(
        agentName,
        config,
        trigger.commitSha,
        trigger.commitContext,
      );
    },
  );
}
