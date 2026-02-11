/**
 * Hunter strategy — builds review context for the Hunter agent.
 *
 * The Hunter focuses on bug/correctness defects.
 * Primarily targets PR-level reviews but supports commit triggers.
 */

import type { AgentProfile } from '@opencode-janitor/shared';
import type {
  AgentRuntimeSpec,
  PrepareContextInput,
  PreparedAgentContext,
} from '../../runtime/agent-runtime-spec';
import {
  buildCommitPreparedContext,
  buildManualWorkspaceOrRepoPreparedContext,
  createAgentSpecFactory,
} from './base-agent-spec';

export function createHunterSpec(profile: AgentProfile): AgentRuntimeSpec {
  return createAgentSpecFactory(
    profile,
    (input: PrepareContextInput, agentName): PreparedAgentContext => {
      const { config, trigger } = input;

      if (trigger.kind === 'manual') {
        return buildManualWorkspaceOrRepoPreparedContext(
          agentName,
          config,
          trigger.commitSha,
          trigger.commitContext,
        );
      }

      if (trigger.kind === 'pr') {
        return buildCommitPreparedContext(
          agentName,
          config,
          trigger.commitSha,
          trigger.commitContext,
          {
            label: `PR #${trigger.prNumber} @ ${trigger.commitSha.slice(0, 8)}`,
            metadataPrefix: [`PR: #${trigger.prNumber}`],
          },
        );
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
