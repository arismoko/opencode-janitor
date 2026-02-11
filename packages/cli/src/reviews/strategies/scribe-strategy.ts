/**
 * Scribe strategy — builds review context for the Scribe agent.
 *
 * The Scribe focuses on documentation drift, gaps, and release notes
 * (DRIFT, GAP, RELEASE). Enriches context with doc-file metadata
 * when documentation files appear in the changeset.
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
import {
  buildDocIndexMetadata,
  buildMarkdownFileInventoryMetadata,
} from './build-doc-index';

export function createScribeSpec(profile: AgentProfile): AgentRuntimeSpec {
  return createAgentSpecFactory(
    profile,
    (input: PrepareContextInput, agentName): PreparedAgentContext => {
      const { config, trigger, job } = input;

      if (trigger.kind === 'manual') {
        const docInventory = buildMarkdownFileInventoryMetadata(job.path);
        const metadata = ['Trigger: manual', 'Mode: full documentation audit'];
        if (docInventory) {
          metadata.push(docInventory);
        }

        return buildRepoPreparedContext(agentName, config, {
          label: 'Manual repo-wide documentation review',
          metadata,
          reason: 'manual-repo',
        });
      }

      const docMeta = buildDocIndexMetadata(
        trigger.commitContext.changedFiles.map((f) => f.path),
      );

      return buildCommitPreparedContext(
        agentName,
        config,
        trigger.commitSha,
        trigger.commitContext,
        {
          ...(docMeta ? { metadataSuffix: [docMeta] } : {}),
        },
      );
    },
  );
}
