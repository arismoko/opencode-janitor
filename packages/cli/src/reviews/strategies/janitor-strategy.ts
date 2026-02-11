/**
 * Janitor strategy — builds review context for the Janitor agent.
 *
 * The Janitor focuses on structural cleanup (YAGNI, DRY, DEAD).
 * It requires a commit diff to analyse changes.
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

export function createJanitorSpec(profile: AgentProfile): AgentRuntimeSpec {
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

      return buildCommitPreparedContext(
        agentName,
        config,
        trigger.commitSha,
        trigger.commitContext,
      );
    },
  );
}
