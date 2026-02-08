import type { Finding, FindingCategory, ReviewResult } from '../types';
import { log } from '../utils/logger';

const VALID_CATEGORIES: FindingCategory[] = [
  'DRY',
  'DEAD',
  'YAGNI',
  'STRUCTURAL',
];

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
  // Check for clean codebase sentinel — match as standalone token,
  // optionally wrapped in backticks, not as a substring of other text.
  if (/(?:^|\s|`)NO_P0_FINDINGS(?:`|\s|$)/m.test(raw)) {
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
 *
 * Parses per-finding blocks to keep all 4 fields aligned.
 * Each finding block starts with a Location field and ends
 * before the next Location or end-of-text.
 *
 * The numeric prefix (e.g. "1.") is optional so we parse both
 * numbered ("1. **Location**: ...") and unnumbered ("**Location**: ...")
 * outputs without silently dropping findings.
 */
function extractFindings(raw: string): Finding[] {
  const findings: Finding[] = [];

  // Split into per-finding blocks anchored on Location fields.
  // Each block runs from one Location to the next (or end of string).
  // The numeric prefix (\d+\.) is optional to handle unnumbered output.
  const blockStarts = [
    ...raw.matchAll(/(?:\d+\.\s*)?\*{0,2}Location\*{0,2}:/gi),
  ];

  for (let i = 0; i < blockStarts.length; i++) {
    const start = blockStarts[i].index;
    const end =
      i + 1 < blockStarts.length ? blockStarts[i + 1].index : raw.length;
    const block = raw.slice(start, end);

    const location = block
      .match(/\*{0,2}Location\*{0,2}:\s*`?([^`\n]+)`?/i)?.[1]
      ?.trim();
    const category = block
      .match(/\*{0,2}Category\*{0,2}:\s*`?(\w+)`?/i)?.[1]
      ?.trim()
      .toUpperCase() as FindingCategory | undefined;
    const evidence = block
      .match(
        /\*{0,2}Evidence\*{0,2}:\s*(.+?)(?=\n\s*(?:\d+\.\s*)?\*{0,2}Prescription|$)/is,
      )?.[1]
      ?.trim();
    const prescription = block
      .match(/\*{0,2}Prescription\*{0,2}:\s*(.+?)$/is)?.[1]
      ?.trim();

    if (!location || !category || !evidence || !prescription) continue;
    if (!VALID_CATEGORIES.includes(category)) continue;

    findings.push({ location, category, evidence, prescription });
  }

  return findings;
}
