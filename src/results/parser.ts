import type { Finding, FindingCategory, ReviewResult } from '../types';
import { log } from '../utils/logger';

const VALID_CATEGORIES: FindingCategory[] = [
  'DRY',
  'DEAD',
  'YAGNI',
  'STRUCTURAL',
];

const NO_FINDINGS_SENTINEL = 'NO_P0_FINDINGS';

/**
 * Parse raw agent output into a structured ReviewResult.
 *
 * Expects findings in the format:
 * 1. **Location**: file:line
 * 2. **Category**: DRY | DEAD | YAGNI | STRUCTURAL
 * 3. **Evidence**: ...
 * 4. **Prescription**: ...
 */
export function parseReviewOutput(raw: string, sha: string): ReviewResult {
  // Check for clean codebase sentinel
  if (raw.includes(NO_FINDINGS_SENTINEL)) {
    log('[parser] clean codebase — no P0 findings');
    return {
      sha,
      subject: '',
      date: new Date(),
      findings: [],
      clean: true,
      raw,
    };
  }

  const findings = extractFindings(raw);

  log(`[parser] extracted ${findings.length} findings`);

  return {
    sha,
    subject: '',
    date: new Date(),
    findings,
    clean: findings.length === 0,
    raw,
  };
}

/**
 * Extract structured findings from raw text.
 * Uses regex to find the Location/Category/Evidence/Prescription pattern.
 */
function extractFindings(raw: string): Finding[] {
  const findings: Finding[] = [];

  // Match finding blocks — look for Location + Category + Evidence + Prescription
  const locationPattern = /\*{0,2}Location\*{0,2}:\s*`?([^`\n]+)`?/gi;
  const categoryPattern = /\*{0,2}Category\*{0,2}:\s*`?(\w+)`?/gi;
  const evidencePattern =
    /\*{0,2}Evidence\*{0,2}:\s*(.+?)(?=\n\s*\d+\.\s*\*{0,2}(?:Prescription|Location)|$)/gis;
  const prescriptionPattern =
    /\*{0,2}Prescription\*{0,2}:\s*(.+?)(?=\n\s*(?:\d+\.\s*\*{0,2}Location|\n#{1,3}\s|\n---)|$)/gis;

  const locations = [...raw.matchAll(locationPattern)].map((m) => m[1].trim());
  const categories = [...raw.matchAll(categoryPattern)].map(
    (m) => m[1].trim().toUpperCase() as FindingCategory,
  );
  const evidences = [...raw.matchAll(evidencePattern)].map((m) => m[1].trim());
  const prescriptions = [...raw.matchAll(prescriptionPattern)].map((m) =>
    m[1].trim(),
  );

  const count = Math.min(
    locations.length,
    categories.length,
    evidences.length,
    prescriptions.length,
  );

  for (let i = 0; i < count; i++) {
    const category = categories[i];
    if (!VALID_CATEGORIES.includes(category)) continue;

    findings.push({
      location: locations[i],
      category,
      evidence: evidences[i],
      prescription: prescriptions[i],
    });
  }

  return findings;
}
