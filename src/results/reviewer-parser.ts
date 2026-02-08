import {
  REVIEWER_DOMAINS,
  REVIEWER_SEVERITIES,
  type ReviewerDomain,
  type ReviewerFinding,
  type ReviewerResult,
  type ReviewerSeverity,
} from '../types';
import { log } from '../utils/logger';

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
  if (!raw.trim()) {
    throw new Error('No text output from reviewer agent');
  }

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
 * Handles fenced code blocks, bare JSON, and multiple JSON objects
 * (e.g. from resumed sessions that produced output twice).
 */
function extractJSON(raw: string): Record<string, unknown> | null {
  // Try fenced code block first: ```json ... ``` or ``` ... ```
  // Use greedy match to find the LAST fenced block (most likely the final output)
  const fencedMatches = [
    ...raw.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g),
  ];
  for (let i = fencedMatches.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(fencedMatches[i][1].trim());
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray(parsed.findings)
      ) {
        return parsed;
      }
    } catch {
      // Try next match
    }
  }

  // Try bare JSON — find matching brace pairs from right to left.
  // Scanning from the end avoids the first-{-to-last-} corruption when
  // multiple JSON objects exist (e.g. from double resume output).
  // String-aware: braces inside JSON string values don't affect depth.
  let depth = 0;
  let end = -1;
  let inString = false;
  for (let i = raw.length - 1; i >= 0; i--) {
    const ch = raw[i];

    // Toggle string state on unescaped double-quotes.
    // Count consecutive backslashes before the quote to determine
    // if it's escaped (odd count) or real (even count, including 0).
    if (ch === '"') {
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && raw[j] === '\\'; j--) {
        backslashes++;
      }
      if (backslashes % 2 === 0) {
        inString = !inString;
      }
      continue;
    }

    // Inside a string, braces are literal characters — skip them
    if (inString) continue;

    if (ch === '}') {
      if (depth === 0) end = i;
      depth++;
    } else if (ch === '{') {
      depth--;
      if (depth === 0 && end !== -1) {
        try {
          const parsed = JSON.parse(raw.slice(i, end + 1));
          if (
            parsed &&
            typeof parsed === 'object' &&
            Array.isArray(parsed.findings)
          ) {
            return parsed;
          }
        } catch {
          // Not valid JSON at this position, keep scanning
        }
        end = -1;
      }
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
  if (!REVIEWER_SEVERITIES.includes(severity as ReviewerSeverity)) return false;
  if (!REVIEWER_DOMAINS.includes(domain as ReviewerDomain)) return false;

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
