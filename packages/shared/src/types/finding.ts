/**
 * Finding types and result containers.
 *
 * All finding shapes are derived from schemas/finding.ts (Zod).
 * This module re-exports derived types and defines result containers.
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
} from '../schemas/finding';
import {
  HunterDomain as _HunterDomainSchema,
  InspectorDomain as _InspectorDomainSchema,
  JanitorDomain as _JanitorDomainSchema,
  ScribeDomain as _ScribeDomainSchema,
  Severity as _SeveritySchema,
} from '../schemas/finding';

// ---------------------------------------------------------------------------
// Re-exported schema-derived types
// ---------------------------------------------------------------------------

export type JanitorDomain = _JanitorDomain;
export type HunterDomain = _HunterDomain;
export type InspectorDomain = _InspectorDomain;
export type ScribeDomain = _ScribeDomain;
export type Severity = _Severity;
export type Finding = _JanitorFinding;
export type HunterFinding = _HunterFinding;
export type InspectorFinding = _InspectorFinding;
export type ScribeFinding = _ScribeFinding;

// ---------------------------------------------------------------------------
// Runtime domain values
// ---------------------------------------------------------------------------

export const HUNTER_DOMAINS: readonly HunterDomain[] =
  _HunterDomainSchema.options;
export const INSPECTOR_DOMAINS: readonly InspectorDomain[] =
  _InspectorDomainSchema.options;
export const SCRIBE_DOMAINS: readonly ScribeDomain[] =
  _ScribeDomainSchema.options;
export const SEVERITIES: readonly Severity[] = _SeveritySchema.options;

// ---------------------------------------------------------------------------
// Severity guide
// ---------------------------------------------------------------------------

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

export interface HunterResult {
  id: string;
  findings: HunterFinding[];
  clean: boolean;
  raw: string;
}

export interface InspectorResult {
  id: string;
  findings: InspectorFinding[];
  clean: boolean;
  raw: string;
}

export interface ScribeResult {
  id: string;
  findings: ScribeFinding[];
  clean: boolean;
  raw: string;
}

export interface ReviewResult {
  sha: string;
  subject: string;
  date: Date;
  findings: Finding[];
  clean: boolean;
  raw: string;
}
