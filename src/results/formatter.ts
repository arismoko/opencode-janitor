import type { ReviewResult } from '../types';
import { renderReport } from './report-renderer';

/**
 * Format a janitor ReviewResult as a markdown report.
 *
 * Delegates to the shared report renderer with janitor-specific view spec.
 */
export function formatReport(
  result: ReviewResult,
  suppressedCount?: number,
): string {
  return renderReport(result.findings, result.clean, {
    title: 'Janitor Report',
    shortId: result.sha.slice(0, 7),
    subject: result.subject,
    date: result.date,
    suppressedCount,
    findingLabel: 'P0 issue',
    showSeverityDomain: false,
  });
}
