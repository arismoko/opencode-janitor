/**
 * Finding and parser metadata types.
 *
 * All finding shapes are derived from review/finding-schemas.ts (Zod).
 * This module re-exports schema-derived finding types.
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
} from '../review/finding-schemas';

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
// Parse metadata
// ---------------------------------------------------------------------------

export type ParseStatus = 'ok' | 'invalid_output' | 'empty_output';

export interface ParseMeta {
  status: ParseStatus;
  error?: string;
}
