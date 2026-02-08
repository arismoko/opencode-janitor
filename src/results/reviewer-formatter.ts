import type { ReviewerResult } from './reviewer-parser';

/**
 * Format a ReviewerResult as a markdown report.
 */
export function formatReviewerReport(result: ReviewerResult): string {
  const shortId = result.id.slice(0, 12);

  if (result.clean) {
    return [
      `# Reviewer Report: ${shortId}`,
      '',
      `**Findings**: None`,
      '',
      'No issues found. Code is clean.',
    ].join('\n');
  }

  const header = [
    `# Reviewer Report: ${shortId}`,
    '',
    `**Findings**: ${result.findings.length} issue${result.findings.length === 1 ? '' : 's'}`,
    '',
    '---',
  ];

  const findingSections = result.findings.map((f, i) => {
    return [
      '',
      `### ${i + 1}. [${f.severity}] ${f.domain} — ${summarizeLocation(f.location)}`,
      '',
      `**Location**: \`${f.location}\``,
      `**Severity**: ${f.severity}`,
      `**Domain**: ${f.domain}`,
      `**Evidence**: ${f.evidence}`,
      `**Prescription**: ${f.prescription}`,
    ].join('\n');
  });

  return [...header, ...findingSections].join('\n');
}

/**
 * Create a short summary from a location string.
 * e.g., "src/utils/helper.ts:42" -> "helper.ts"
 */
function summarizeLocation(location: string): string {
  const filePart = location.split(':')[0];
  const segments = filePart.split('/');
  return segments[segments.length - 1] || filePart;
}
