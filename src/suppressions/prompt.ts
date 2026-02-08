import { suffix2 } from '../findings/fingerprint';
import { isExpired } from './matcher';
import type { Suppression } from './types';

const MAX_PROMPT_BYTES = 1536;

/**
 * Build a compact suppression block for system prompt injection.
 * Returns empty string if no active suppressions.
 */
export function buildSuppressionsBlock(suppressions: Suppression[]): string {
  const active = suppressions.filter(
    (s) => !isExpired(s) && !s.needsRevalidation,
  );

  if (active.length === 0) return '';

  // Sort by lastSeenAt descending (most recently seen first)
  active.sort(
    (a, b) =>
      new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
  );

  const header = '[SUPPRESSIONS_V1]\n';
  const footer = '[/SUPPRESSIONS_V1]';
  let budget =
    MAX_PROMPT_BYTES - Buffer.byteLength(header) - Buffer.byteLength(footer);
  const lines: string[] = [];

  for (const s of active) {
    const suffix = suffix2(s.original.location);
    // Extract shape hash from scopedKey (format: "category|shapeHash")
    const shape = s.scopedKey.split('|')[1] ?? '';
    const reason = s.reason ?? s.original.prescription;
    const line = `${s.original.category}|${suffix}|${shape}|reason: ${reason}`;
    const lineBytes = Buffer.byteLength(line + '\n');

    if (budget - lineBytes < 0) break;

    lines.push(line);
    budget -= lineBytes;
  }

  if (lines.length === 0) return '';

  return header + lines.join('\n') + '\n' + footer;
}
