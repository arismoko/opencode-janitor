import type { ReviewResult } from '../types';

/**
 * Format a ReviewResult as a markdown report.
 */
export function formatReport(result: ReviewResult): string {
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
    '',
    '---',
  ];

  const findingSections = result.findings.map((f, i) => {
    return [
      '',
      `### ${i + 1}. ${f.category} — ${summarizeLocation(f.location)}`,
      '',
      `**Location**: \`${f.location}\``,
      `**Evidence**: ${f.evidence}`,
      `**Prescription**: ${f.prescription}`,
    ].join('\n');
  });

  return [...header, ...findingSections].join('\n');
}

/**
 * Create a short summary from a location string.
 * e.g., "src/utils/helper.ts:42" → "helper.ts"
 */
function summarizeLocation(location: string): string {
  const filePart = location.split(':')[0];
  const segments = filePart.split('/');
  return segments[segments.length - 1] || filePart;
}
