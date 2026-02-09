import { summarizeLocation } from './format-helpers';

// ---------------------------------------------------------------------------
// View spec — per-agent report configuration
// ---------------------------------------------------------------------------

export interface ReportViewSpec {
  /** Report title prefix (e.g. "Janitor Report", "Reviewer Report") */
  title: string;
  /** Short identifier shown in header (sha, pr id, etc.) */
  shortId: string;
  /** Optional commit subject line */
  subject?: string;
  /** Date to display (janitor shows commit date) */
  date?: Date;
  /** Count of suppressed findings (janitor only) */
  suppressedCount?: number;
  /** Finding label (e.g. "P0 issue", "issue") */
  findingLabel: string;
  /** Whether to show severity/domain inline in finding rows */
  showSeverityDomain: boolean;
  /** Extra markdown sections appended after findings */
  extraSections?: string;
}

// ---------------------------------------------------------------------------
// Unified finding shape for rendering
// ---------------------------------------------------------------------------

interface RenderableFinding {
  location: string;
  domain: string;
  severity?: string;
  evidence: string;
  prescription: string;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/**
 * Render a unified markdown report from findings and a view spec.
 *
 * Replaces both `formatReport` (janitor) and `formatReviewerReport` (reviewer)
 * with a single parameterized implementation.
 */
export function renderReport(
  findings: RenderableFinding[],
  clean: boolean,
  spec: ReportViewSpec,
): string {
  if (clean) {
    return renderClean(spec);
  }
  return renderFindings(findings, spec);
}

function renderClean(spec: ReportViewSpec): string {
  const lines = [`# ${spec.title}: ${spec.shortId}`, ''];

  if (spec.subject) {
    lines.push(`**Commit**: ${spec.shortId} — "${spec.subject}"`);
  }
  if (spec.date) {
    lines.push(`**Date**: ${spec.date.toISOString()}`);
  }
  lines.push(`**Findings**: None`, '', `No issues found. Code is clean.`);

  if (spec.extraSections) {
    lines.push('', spec.extraSections);
  }

  return lines.join('\n');
}

function renderFindings(
  findings: RenderableFinding[],
  spec: ReportViewSpec,
): string {
  const count = findings.length;
  const countLabel = `${count} ${spec.findingLabel}${count === 1 ? '' : 's'}`;

  const header = [`# ${spec.title}: ${spec.shortId}`, ''];

  if (spec.subject) {
    header.push(`**Commit**: ${spec.shortId} — "${spec.subject}"`);
  }
  if (spec.date) {
    header.push(`**Date**: ${spec.date.toISOString()}`);
  }
  header.push(`**Findings**: ${countLabel}`);

  if (spec.suppressedCount) {
    header.push(`**Suppressed**: ${spec.suppressedCount} previously reviewed`);
  }

  header.push('', '---');

  const findingSections = findings.map((f, i) => {
    const titlePrefix = spec.showSeverityDomain
      ? `[${f.severity}] ${f.domain}`
      : f.domain;

    const lines = [
      '',
      `### ${i + 1}. ${titlePrefix} — ${summarizeLocation(f.location)}`,
      '',
      `**Location**: \`${f.location}\``,
    ];

    if (spec.showSeverityDomain) {
      lines.push(`**Severity**: ${f.severity}`);
      lines.push(`**Domain**: ${f.domain}`);
    }

    lines.push(`**Evidence**: ${f.evidence}`);
    lines.push(`**Prescription**: ${f.prescription}`);

    return lines.join('\n');
  });

  const result = [...header, ...findingSections];

  if (spec.extraSections) {
    result.push('', spec.extraSections);
  }

  return result.join('\n');
}
