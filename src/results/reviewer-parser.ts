import { log } from '../utils/logger';

/** Allowed severity levels for reviewer findings */
export type ReviewerSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** Allowed domain categories for reviewer findings */
export type ReviewerDomain =
  | 'BUG'
  | 'SECURITY'
  | 'PERFORMANCE'
  | 'ARCHITECTURE'
  | 'DOCS'
  | 'SPEC';

/** A single finding from the code reviewer agent */
export interface ReviewerFinding {
  location: string;
  severity: ReviewerSeverity;
  domain: ReviewerDomain;
  evidence: string;
  prescription: string;
}

/** Parsed reviewer result */
export interface ReviewerResult {
  id: string;
  findings: ReviewerFinding[];
  clean: boolean;
  raw: string;
}

const VALID_SEVERITIES: ReviewerSeverity[] = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
];

const VALID_DOMAINS: ReviewerDomain[] = [
  'BUG',
  'SECURITY',
  'PERFORMANCE',
  'ARCHITECTURE',
  'DOCS',
  'SPEC',
];

/**
 * Parse raw assistant text into a structured ReviewerResult.
 *
 * Accepts:
 * - Raw JSON object
 * - Fenced code block ```json ... ```
 * - If invalid JSON, returns clean result with zero findings but preserves raw text
 *
 * Ignores malformed findings; keeps only valid ones.
 */
export function parseReviewerOutput(raw: string, id: string): ReviewerResult {
  const parsed = extractJSON(raw);

  if (!parsed || !Array.isArray(parsed.findings)) {
    log('[reviewer-parser] no valid JSON found, returning clean result');
    return { id, findings: [], clean: true, raw };
  }

  const findings = parsed.findings.filter(isValidFinding).map(normalizeFinding);

  log(`[reviewer-parser] extracted ${findings.length} valid findings`);

  return {
    id,
    findings,
    clean: findings.length === 0,
    raw,
  };
}

/**
 * Try to extract a JSON object from raw text.
 * Handles both bare JSON and fenced code blocks.
 */
function extractJSON(raw: string): Record<string, unknown> | null {
  // Try fenced code block first: ```json ... ``` or ``` ... ```
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Fall through to bare JSON attempt
    }
  }

  // Try bare JSON — find the first { ... } block
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(raw.slice(braceStart, braceEnd + 1));
    } catch {
      // Invalid JSON
    }
  }

  return null;
}

/**
 * Validate that a finding object has all required fields with correct types.
 */
function isValidFinding(f: unknown): f is Record<string, unknown> {
  if (!f || typeof f !== 'object') return false;
  const obj = f as Record<string, unknown>;
  if (typeof obj.location !== 'string' || !obj.location) return false;
  if (typeof obj.severity !== 'string') return false;
  if (typeof obj.domain !== 'string') return false;
  if (typeof obj.evidence !== 'string' || !obj.evidence) return false;
  if (typeof obj.prescription !== 'string' || !obj.prescription) return false;

  const severity = obj.severity.toUpperCase();
  const domain = obj.domain.toUpperCase();
  if (!VALID_SEVERITIES.includes(severity as ReviewerSeverity)) return false;
  if (!VALID_DOMAINS.includes(domain as ReviewerDomain)) return false;

  return true;
}

/**
 * Normalize a validated finding into the canonical shape.
 */
function normalizeFinding(f: Record<string, unknown>): ReviewerFinding {
  return {
    location: f.location as string,
    severity: (f.severity as string).toUpperCase() as ReviewerSeverity,
    domain: (f.domain as string).toUpperCase() as ReviewerDomain,
    evidence: f.evidence as string,
    prescription: f.prescription as string,
  };
}
