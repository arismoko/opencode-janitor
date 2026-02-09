import type { ReviewResult } from '../types';
import { summarizeLocation } from './format-helpers';

/**
 * Format a ReviewResult as a markdown report.
 */
export function formatReport(
  result: ReviewResult,
  suppressedCount?: number,
): string {
  const shortSha = result.sha.slice(0, 7);
  const dateStr = result.date.toISOString();

  if (result.clean) {
    return [
      `# Janitor Report: ${shortSha}`,
      '',
      `**Commit**: ${shortSha}${result.subject ? ` — "${result.subject}"` : ''}`,
      `**Date**: ${dateStr}`,
      `**Findings**: None`,
      '',
      'No P0 issues found. Codebase is clean.',
    ].join('\n');
  }

  const header = [
    `# Janitor Report: ${shortSha}`,
    '',
    `**Commit**: ${shortSha}${result.subject ? ` — "${result.subject}"` : ''}`,
    `**Date**: ${dateStr}`,
    `**Findings**: ${result.findings.length} P0 issue${result.findings.length === 1 ? '' : 's'}`,
    ...(suppressedCount
      ? [`**Suppressed**: ${suppressedCount} previously reviewed`]
      : []),
    '',
    '---',
  ];

  const findingSections = result.findings.map((f, i) => {
    return [
      '',
      `### ${i + 1}. ${f.domain} — ${summarizeLocation(f.location)}`,
      '',
      `**Location**: \`${f.location}\``,
      `**Evidence**: ${f.evidence}`,
      `**Prescription**: ${f.prescription}`,
    ].join('\n');
  });

  return [...header, ...findingSections].join('\n');
}
