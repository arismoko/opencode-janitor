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
  InspectorDomain as _InspectorDomain,
  InspectorFinding as _InspectorFinding,
  JanitorDomain as _JanitorDomain,
  JanitorFinding as _JanitorFinding,
  ScribeDomain as _ScribeDomain,
  ScribeFinding as _ScribeFinding,
  Severity as _Severity,
} from './schemas/finding';
import {
  HunterDomain as _HunterDomainSchema,
  InspectorDomain as _InspectorDomainSchema,
  JanitorDomain as _JanitorDomainSchema,
  ScribeDomain as _ScribeDomainSchema,
  Severity as _SeveritySchema,
} from './schemas/finding';

// ---------------------------------------------------------------------------
// Re-exported schema-derived types (source of truth: schemas/finding.ts)
// ---------------------------------------------------------------------------

/** Janitor finding domain */
export type JanitorDomain = _JanitorDomain;

/** Hunter finding domain */
export type HunterDomain = _HunterDomain;

/** Inspector finding domain */
export type InspectorDomain = _InspectorDomain;

/** Scribe finding domain */
export type ScribeDomain = _ScribeDomain;

/** Severity level shared by all agents */
export type Severity = _Severity;

/** A single janitor finding (schema-derived) */
export type Finding = _JanitorFinding;

/** A single hunter finding (schema-derived) */
export type HunterFinding = _HunterFinding;

/** A single inspector finding (schema-derived) */
export type InspectorFinding = _InspectorFinding;

/** A single scribe finding (schema-derived) */
export type ScribeFinding = _ScribeFinding;

// ---------------------------------------------------------------------------
// Runtime domain values (derived from Zod schema)
// ---------------------------------------------------------------------------

/** All valid hunter domain values as a runtime array */
export const HUNTER_DOMAINS: readonly HunterDomain[] =
  _HunterDomainSchema.options;

/** All valid inspector domain values as a runtime array */
export const INSPECTOR_DOMAINS: readonly InspectorDomain[] =
  _InspectorDomainSchema.options;

/** All valid scribe domain values as a runtime array */
export const SCRIBE_DOMAINS: readonly ScribeDomain[] =
  _ScribeDomainSchema.options;

/** All valid severity values as a runtime array */
export const SEVERITIES: readonly Severity[] = _SeveritySchema.options;

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

/** Parsed inspector result */
export interface InspectorResult {
  id: string;
  findings: InspectorFinding[];
  clean: boolean;
  raw: string;
}

/** Parsed scribe result */
export interface ScribeResult {
  id: string;
  findings: ScribeFinding[];
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
  deletionOnly: boolean;
}

/** Signal source for commit detection */
export type SignalSource = 'fswatch' | 'tool-hook' | 'poll';

/** A commit detection signal */
export interface CommitSignal {
  source: SignalSource;
  ts: number;
}
