/**
 * Shared Zod schemas for agent output validation.
 *
 * Single source of truth for both:
 * 1. Runtime parsing/validation (via Zod)
 * 2. Prompt injection (via z.toJSONSchema())
 *
 * Each agent defines its own finding schema extending the base fields,
 * and a top-level output schema wrapping an array of findings.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

/** Severity levels shared by all agents */
export const Severity = z.enum(['P0', 'P1', 'P2', 'P3']);
export type Severity = z.infer<typeof Severity>;

// ---------------------------------------------------------------------------
// Base finding (shared fields)
// ---------------------------------------------------------------------------

/** Fields common to all agent findings */
export const BaseFinding = z.object({
  location: z.string().describe('file:line'),
  severity: Severity,
  evidence: z.string().describe('Concrete proof of the issue'),
  prescription: z.string().describe('Exact action to fix'),
});

// ---------------------------------------------------------------------------
// Janitor schemas
// ---------------------------------------------------------------------------

/** Janitor domain categories */
export const JanitorDomain = z.enum(['YAGNI', 'DRY', 'DEAD']);
export type JanitorDomain = z.infer<typeof JanitorDomain>;

/** A single janitor finding */
export const JanitorFinding = BaseFinding.extend({
  domain: JanitorDomain,
});
export type JanitorFinding = z.infer<typeof JanitorFinding>;

/** Top-level janitor output */
export const JanitorOutput = z.object({
  findings: z.array(JanitorFinding),
});
export type JanitorOutput = z.infer<typeof JanitorOutput>;

// ---------------------------------------------------------------------------
// Hunter schemas
// ---------------------------------------------------------------------------

/** Hunter domain categories */
export const HunterDomain = z.enum(['BUG', 'SECURITY', 'CORRECTNESS']);
export type HunterDomain = z.infer<typeof HunterDomain>;

/** A single hunter finding */
export const HunterFinding = BaseFinding.extend({
  domain: HunterDomain,
});
export type HunterFinding = z.infer<typeof HunterFinding>;

/** Top-level hunter output */
export const HunterOutput = z.object({
  findings: z.array(HunterFinding),
});
export type HunterOutput = z.infer<typeof HunterOutput>;

// ---------------------------------------------------------------------------
// Inspector schemas
// ---------------------------------------------------------------------------

/** Inspector domain categories */
export const InspectorDomain = z.enum(['COMPLEXITY', 'DESIGN', 'SMELL']);
export type InspectorDomain = z.infer<typeof InspectorDomain>;

/** A single inspector finding */
export const InspectorFinding = BaseFinding.extend({
  domain: InspectorDomain,
});
export type InspectorFinding = z.infer<typeof InspectorFinding>;

/** Top-level inspector output */
export const InspectorOutput = z.object({
  findings: z.array(InspectorFinding),
});
export type InspectorOutput = z.infer<typeof InspectorOutput>;

// ---------------------------------------------------------------------------
// Scribe schemas
// ---------------------------------------------------------------------------

/** Scribe domain categories */
export const ScribeDomain = z.enum(['DRIFT', 'GAP', 'RELEASE']);
export type ScribeDomain = z.infer<typeof ScribeDomain>;

/** A single scribe finding */
export const ScribeFinding = BaseFinding.extend({
  domain: ScribeDomain,
});
export type ScribeFinding = z.infer<typeof ScribeFinding>;

/** Top-level scribe output */
export const ScribeOutput = z.object({
  findings: z.array(ScribeFinding),
});
export type ScribeOutput = z.infer<typeof ScribeOutput>;
