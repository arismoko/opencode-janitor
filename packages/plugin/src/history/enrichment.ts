import type { TrendData } from './trends';
import type { AnnotatedFinding, FindingLedgerEntry } from './types';

export interface EnrichmentData {
  annotatedFindings: AnnotatedFinding[];
  resolved: FindingLedgerEntry[];
  trends: TrendData;
}

/** Enrich toast message with lifecycle breakdown */
export function enrichToastMessage(
  baseMessage: string,
  data: EnrichmentData,
): string {
  const counts = countByLifecycle(data.annotatedFindings);
  const parts: string[] = [];

  if (counts.new > 0) parts.push(`${counts.new} new`);
  if (counts.persistent > 0) parts.push(`${counts.persistent} persistent`);
  if (counts.regressed > 0) parts.push(`${counts.regressed} regressed`);

  if (parts.length === 0) return baseMessage;
  return `${baseMessage} (${parts.join(', ')})`;
}

/** Build a markdown history section for reports */
export function buildHistorySection(data: EnrichmentData): string {
  const counts = countByLifecycle(data.annotatedFindings);
  const trendArrow =
    data.trends.overallTrend === 'improving'
      ? '↘'
      : data.trends.overallTrend === 'worsening'
        ? '↗'
        : '→';

  const lines: string[] = [
    '',
    '---',
    '',
    '## History Signals',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| New findings | ${counts.new} |`,
    `| Persistent (seen before) | ${counts.persistent} |`,
    `| Regressed (were fixed) | ${counts.regressed} |`,
    `| Resolved since last review | ${data.resolved.length} |`,
    `| Overall trend (last ${data.trends.reviewCount}) | ${trendArrow} ${data.trends.overallTrend} |`,
    `| Avg findings/review | ${data.trends.avgFindings.toFixed(1)} |`,
  ];

  // Persistent findings section
  const persistent = data.annotatedFindings.filter(
    (a) => a.lifecycle === 'persistent' && a.streak >= 3,
  );
  if (persistent.length > 0) {
    lines.push('', '### Persistent Findings', '');
    for (const a of persistent) {
      lines.push(
        `- **${a.finding.domain}** in \`${a.finding.location}\` — seen in ${a.streak} consecutive reviews`,
      );
    }
  }

  // Regressions section
  const regressions = data.annotatedFindings.filter(
    (a) => a.lifecycle === 'regressed',
  );
  if (regressions.length > 0) {
    lines.push('', '### Regressions', '');
    for (const a of regressions) {
      lines.push(
        `- **${a.finding.domain}** in \`${a.finding.location}\` — was resolved, now regressed`,
      );
    }
  }

  return lines.join('\n');
}

function countByLifecycle(
  findings: AnnotatedFinding[],
): Record<string, number> {
  const counts: Record<string, number> = {
    new: 0,
    persistent: 0,
    regressed: 0,
    resolved: 0,
  };
  for (const f of findings) {
    counts[f.lifecycle] = (counts[f.lifecycle] ?? 0) + 1;
  }
  return counts;
}
