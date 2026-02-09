/**
 * Core domain types for opencode-janitor.
 *
 * Enum values and finding shapes are derived from src/schemas/finding.ts
 * (Zod schemas). This module re-exports derived types and defines
 * result containers and infrastructure types.
 */
import type {
  HunterDomain as _HunterDomain,
  HunterFinding as _HunterFinding,
  JanitorDomain as _JanitorDomain,
  JanitorFinding as _JanitorFinding,
  Severity as _Severity,
} from './schemas/finding';
import {
  HunterDomain as _HunterDomainSchema,
  JanitorDomain as _JanitorDomainSchema,
  Severity as _SeveritySchema,
} from './schemas/finding';

// ---------------------------------------------------------------------------
// Re-exported schema-derived types (source of truth: schemas/finding.ts)
// ---------------------------------------------------------------------------

/** Janitor finding domain */
export type FindingCategory = _JanitorDomain;

/** Hunter finding domain */
export type HunterDomain = _HunterDomain;

/** Severity level shared by all agents */
export type ReviewerSeverity = _Severity;

/** A single janitor finding (schema-derived) */
export type Finding = _JanitorFinding;

/** A single hunter finding (schema-derived) */
export type HunterFinding = _HunterFinding;

// ---------------------------------------------------------------------------
// Runtime domain values (derived from Zod schema)
// ---------------------------------------------------------------------------

/** All valid janitor domain values as a runtime array */
export const FINDING_CATEGORIES: readonly FindingCategory[] =
  _JanitorDomainSchema.options;

/** Pipe-separated domain string for prompt injection */
export const CATEGORY_PIPE_STR: string = FINDING_CATEGORIES.join(' | ');

/** All valid hunter domain values as a runtime array */
export const HUNTER_DOMAINS: readonly HunterDomain[] =
  _HunterDomainSchema.options;

/** All valid severity values as a runtime array */
export const REVIEWER_SEVERITIES: readonly ReviewerSeverity[] =
  _SeveritySchema.options;

// ---------------------------------------------------------------------------
// Severity guide (descriptive text, not in schema)
// ---------------------------------------------------------------------------

/** Canonical severity guide — P0-P3 descriptions for prompts */
export const SEVERITY_GUIDE = [
  'P0: Must fix before merge — broken, vulnerable, or data-loss risk',
  'P1: Should fix soon — clear defect or significant maintenance burden',
  'P2: Fix when convenient — real issue but low blast radius',
  'P3: Consider — minor, worth noting for future awareness',
] as const;

/** @deprecated Use SEVERITY_GUIDE */
export const REVIEWER_SEVERITY_GUIDE = SEVERITY_GUIDE;

// ---------------------------------------------------------------------------
// Parse metadata
// ---------------------------------------------------------------------------

export type ParseStatus = 'ok' | 'invalid_output' | 'empty_output';

export interface ParseMeta {
  status: ParseStatus;
  error?: string;
}

// ---------------------------------------------------------------------------
// Result containers
// ---------------------------------------------------------------------------

/** Parsed hunter result */
export interface HunterResult {
  id: string;
  findings: HunterFinding[];
  clean: boolean;
  raw: string;
}

/** Parsed janitor review result */
export interface ReviewResult {
  sha: string;
  subject: string;
  date: Date;
  findings: Finding[];
  clean: boolean;
  raw: string;
}

// ---------------------------------------------------------------------------
// Git / infrastructure types
// ---------------------------------------------------------------------------

/** Changed file entry from git diff-tree */
export interface ChangedFile {
  status: string;
  path: string;
}

/** Full commit context for building review prompts */
export interface CommitContext {
  sha: string;
  subject: string;
  parents: string[];
  changedFiles: ChangedFile[];
  patch: string;
  patchTruncated: boolean;
}

/** Signal source for commit detection */
export type SignalSource = 'fswatch' | 'tool-hook' | 'poll';

/** A commit detection signal */
export interface CommitSignal {
  source: SignalSource;
  ts: number;
}

/** Review job in the orchestrator queue */
export interface ReviewJob {
  sha: string;
  parentSessionId?: string;
  sessionId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  enqueuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: ReviewResult;
  error?: string;
}

/** Sink interface for delivering results */
export interface ResultSink {
  deliver(result: ReviewResult, parentSessionId?: string): Promise<void>;
}
