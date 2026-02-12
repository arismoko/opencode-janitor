/**
 * Agent runtime spec — captures per-agent differences as data.
 *
 * Each spec encodes trigger support, config resolution, and review context
 * building, eliminating branching in the scheduler worker.
 */

import type {
  AgentName,
  AgentProfile,
  CommitContext,
  PromptConfig,
  ReviewContext,
  ScopeId,
  TriggerId,
} from '@opencode-janitor/shared';
import type { CliConfig } from '../config/schema';
import type { FindingRow } from '../db/models';

// ---------------------------------------------------------------------------
// Trigger-discriminated context input
// ---------------------------------------------------------------------------

export interface CommitTriggerContext {
  kind: 'commit';
  commitSha: string;
  commitContext: CommitContext;
}

export interface PrTriggerContext {
  kind: 'pr';
  commitSha: string;
  commitContext: CommitContext;
  prNumber: number;
}

export interface ManualTriggerContext {
  kind: 'manual';
  commitSha: string;
  commitContext: CommitContext;
  note?: string;
  focusPath?: string;
}

export type TriggerContext =
  | CommitTriggerContext
  | PrTriggerContext
  | ManualTriggerContext;

// ---------------------------------------------------------------------------
// Parsed output types
// ---------------------------------------------------------------------------

export interface ParsedFinding {
  severity: string;
  domain: string;
  location: string;
  evidence: string;
  prescription: string;
  [key: string]: unknown;
}

export interface ParsedAgentOutput {
  findings: ParsedFinding[];
}

// ---------------------------------------------------------------------------
// Spec I/O interfaces
// ---------------------------------------------------------------------------

export interface PrepareContextInput {
  config: CliConfig;
  run: {
    id: string;
    repo_id: string;
    trigger_event_id: string;
    trigger_id: TriggerId;
    scope: ScopeId;
    path: string;
    default_branch: string;
  };
  trigger: TriggerContext;
}

export interface PreparedAgentContext {
  reviewContext: ReviewContext;
  promptConfig: PromptConfig;
}

export interface BuildPromptInput {
  preparedContext: PreparedAgentContext;
}

export interface SuccessInput {
  run: PrepareContextInput['run'];
  reviewRunId: string;
  output: ParsedAgentOutput;
}

export type PersistableFindingRow = Omit<
  FindingRow,
  'id' | 'created_at' | 'review_run_id'
>;

// ---------------------------------------------------------------------------
// Runtime spec interface
// ---------------------------------------------------------------------------

export interface AgentRuntimeSpec {
  /** Agent identifier */
  agent: AgentName;

  /** Shared profile for this agent */
  profile: AgentProfile;

  /** Key into config.agents */
  configKey: AgentName;

  /** Whether this spec can handle the given trigger kind. */
  supportsTrigger(config: CliConfig, kind: TriggerId): boolean;

  /** Maximum findings from config. */
  maxFindings(config: CliConfig): number;

  /** Resolved model ID (provider/model format). */
  modelId(config: CliConfig): string;

  /** Variant from config. */
  variant(config: CliConfig): string | undefined;

  /** Build execution context (review context + prompt config). */
  prepareContext(input: PrepareContextInput): PreparedAgentContext;

  /** Build the final user prompt from prepared context. */
  buildPrompt(input: BuildPromptInput): string;

  /** Parse raw assistant output into typed findings. Throws on invalid output. */
  parseOutput(rawOutput: string): ParsedAgentOutput;

  /** Map parsed output into DB finding rows for successful runs. */
  onSuccess(input: SuccessInput): PersistableFindingRow[];
}
