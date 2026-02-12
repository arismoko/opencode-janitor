import type { QueuedReviewRunRow } from '../db/queries/review-run-queries';
import type { PersistableFindingRow } from '../runtime/agent-runtime-spec';
import {
  type PrJobPayload,
  parseReviewJobPayload,
} from '../runtime/review-job-payload';
import { type GitCommandResult, runGhCommand } from '../utils/git';

const MAX_COMMENT_BODY_LENGTH = 60_000;

function safeMarkdownText(value: string): string {
  return value.replaceAll(/\r\n?/g, '\n').trim();
}

export function extractPrNumberAndSha(
  run: Pick<QueuedReviewRunRow, 'payload_json'>,
): {
  prNumber: number;
  sha?: string;
} {
  const payload = parseReviewJobPayload(run.payload_json, 'pr');
  const prPayload = payload as PrJobPayload;
  return {
    prNumber: prPayload.prNumber,
    ...(prPayload.sha ? { sha: prPayload.sha } : {}),
  };
}

export function buildPrReviewCommentBody(input: {
  run: Pick<QueuedReviewRunRow, 'id' | 'agent'>;
  findings: PersistableFindingRow[];
  sha?: string;
}): string {
  const lines: string[] = [
    '## Opencode Janitor Review Result',
    '',
    `- Agent: \`${input.run.agent}\``,
    `- Review run: \`${input.run.id}\``,
    ...(input.sha ? [`- Commit: \`${input.sha}\``] : []),
    `- Findings: **${input.findings.length}**`,
    '',
  ];

  if (input.findings.length === 0) {
    lines.push('No findings were reported for this PR-triggered review run.');
    return lines.join('\n');
  }

  lines.push('### Findings', '');

  for (let i = 0; i < input.findings.length; i += 1) {
    const finding = input.findings[i];
    lines.push(
      `${i + 1}. **${safeMarkdownText(finding.severity)} · ${safeMarkdownText(finding.domain)}**`,
      `   - Location: \`${safeMarkdownText(finding.location)}\``,
      `   - Evidence: ${safeMarkdownText(finding.evidence)}`,
      `   - Prescription: ${safeMarkdownText(finding.prescription)}`,
      '',
    );
  }

  return lines.join('\n').trimEnd();
}

export function truncateCommentBody(body: string): string {
  if (body.length <= MAX_COMMENT_BODY_LENGTH) {
    return body;
  }

  const suffix = '\n\n...truncated';
  const maxPrefixLength = Math.max(0, MAX_COMMENT_BODY_LENGTH - suffix.length);
  return `${body.slice(0, maxPrefixLength)}${suffix}`;
}

export type PrReviewCommentResult =
  | { ok: true; prNumber: number }
  | { ok: false; error: string; prNumber?: number };

type RunGh = (
  cwd: string,
  args: string[],
  options?: { trimOutput?: boolean },
) => GitCommandResult;

export async function postPrReviewComment(
  run: Pick<QueuedReviewRunRow, 'id' | 'agent' | 'path' | 'payload_json'>,
  findings: PersistableFindingRow[],
  deps?: { runGh?: RunGh },
): Promise<PrReviewCommentResult> {
  let prNumber: number | undefined;
  try {
    const parsed = extractPrNumberAndSha(run);
    prNumber = parsed.prNumber;
    const body = truncateCommentBody(
      buildPrReviewCommentBody({
        run,
        findings,
        sha: parsed.sha,
      }),
    );

    const gh = deps?.runGh ?? runGhCommand;
    const result = gh(run.path, [
      'pr',
      'comment',
      String(parsed.prNumber),
      '--body',
      body,
    ]);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        prNumber,
        error:
          result.stderr || result.stdout || `gh exited with ${result.exitCode}`,
      };
    }

    return { ok: true, prNumber: parsed.prNumber };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      ...(prNumber !== undefined ? { prNumber } : {}),
      error: message,
    };
  }
}
