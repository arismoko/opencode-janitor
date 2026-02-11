/**
 * Clipboard utilities for the dashboard.
 *
 * Provides report serialization (pure) and system clipboard integration
 * (side-effecting via child_process). Extracted from app.tsx to keep the
 * root component focused on state orchestration.
 */

import { spawnSync } from 'node:child_process';
import { shortRepoName } from './helpers';
import type { CachedReportDetail } from './types';

/**
 * Serialize a report detail into a human-readable clipboard string.
 * Pure function -- no side effects.
 */
export function serializeReportForClipboard(
  detail: CachedReportDetail,
): string {
  const { report, findings, rawOutput } = detail.data;
  const lines: string[] = [];
  lines.push(`Agent: ${report.agent}`);
  lines.push(`Repo: ${report.repoPath}`);
  lines.push(
    `Status: ${report.status}${report.outcome ? ` / ${report.outcome}` : ''}`,
  );
  lines.push(
    `Findings: ${report.findingsCount} (P0:${report.p0Count} P1:${report.p1Count} P2:${report.p2Count} P3:${report.p3Count})`,
  );
  lines.push('');

  if (findings.length > 0) {
    lines.push('Findings:');
    for (const finding of findings) {
      lines.push(
        `- [${finding.severity}] ${finding.domain} @ ${finding.location}`,
      );
      lines.push(`  evidence: ${finding.evidence}`);
      lines.push(`  prescription: ${finding.prescription}`);
      lines.push('');
    }
  } else if (rawOutput) {
    lines.push('Raw output:');
    lines.push(rawOutput);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Copy text to the system clipboard using available CLI utilities.
 * Tries wl-copy, xclip, xsel, and pbcopy in order.
 *
 * @throws {Error} When no clipboard utility is available.
 */
export function copyToClipboard(text: string): void {
  const attempts = [
    { cmd: 'wl-copy', args: [] as string[] },
    { cmd: 'xclip', args: ['-selection', 'clipboard'] },
    { cmd: 'xsel', args: ['--clipboard', '--input'] },
    { cmd: 'pbcopy', args: [] as string[] },
  ];

  for (const attempt of attempts) {
    const result = spawnSync(attempt.cmd, attempt.args, {
      input: text,
      encoding: 'utf8',
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    if (!result.error && result.status === 0) return;
  }

  throw new Error('No clipboard utility available (wl-copy/xclip/xsel/pbcopy)');
}
