/**
 * Diff truncation utilities for controlling prompt size.
 * All functions are pure — no side effects.
 */

export interface TruncationLimits {
  maxPatchBytes: number;
  maxFilesInPatch: number;
  maxHunksPerFile: number;
}

export interface TruncationResult {
  patch: string;
  truncated: boolean;
  stats: {
    originalBytes: number;
    finalBytes: number;
    originalFiles: number;
    includedFiles: number;
  };
}

/**
 * Split a unified diff into per-file sections.
 * Each section starts with "diff --git" or "--- a/" line.
 */
function splitDiffByFile(patch: string): string[] {
  const sections: string[] = [];
  const lines = patch.split('\n');
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      sections.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) {
    sections.push(current.join('\n'));
  }

  return sections;
}

/**
 * Count hunks in a diff section (lines starting with @@).
 */
function countHunks(section: string): number {
  return section.split('\n').filter((l) => l.startsWith('@@ ')).length;
}

/**
 * Truncate hunks in a diff section to maxHunks.
 * Keeps the file header and first N hunks.
 */
function truncateHunks(section: string, maxHunks: number): string {
  const lines = section.split('\n');
  const result: string[] = [];
  let hunkCount = 0;

  for (const line of lines) {
    if (line.startsWith('@@ ')) {
      hunkCount++;
      if (hunkCount > maxHunks) {
        result.push(
          `... (${countHunks(section) - maxHunks} more hunks truncated)`,
        );
        break;
      }
    }
    result.push(line);
  }

  return result.join('\n');
}

/**
 * Estimate churn (lines changed) in a diff section.
 */
function estimateChurn(section: string): number {
  return section
    .split('\n')
    .filter((l) => l.startsWith('+') || l.startsWith('-'))
    .filter((l) => !l.startsWith('+++') && !l.startsWith('---')).length;
}

/**
 * Truncate a full unified diff according to limits.
 * Prioritizes files by churn (most changed files first).
 */
export function truncatePatch(
  patch: string,
  limits: TruncationLimits,
): TruncationResult {
  const originalBytes = new TextEncoder().encode(patch).length;
  const sections = splitDiffByFile(patch);
  const originalFiles = sections.length;

  // If under all limits, return as-is
  if (
    originalBytes <= limits.maxPatchBytes &&
    originalFiles <= limits.maxFilesInPatch
  ) {
    return {
      patch,
      truncated: false,
      stats: {
        originalBytes,
        finalBytes: originalBytes,
        originalFiles,
        includedFiles: originalFiles,
      },
    };
  }

  // Sort by churn (most changed first) for priority inclusion
  const ranked = sections
    .map((s, i) => ({ section: s, churn: estimateChurn(s), index: i }))
    .sort((a, b) => b.churn - a.churn);

  // Take top N files by limit
  const selected = ranked.slice(0, limits.maxFilesInPatch);

  // Truncate hunks per file
  let result = selected
    .map((s) => truncateHunks(s.section, limits.maxHunksPerFile))
    .join('\n');

  // Enforce byte limit
  const encoder = new TextEncoder();
  if (encoder.encode(result).length > limits.maxPatchBytes) {
    const bytes = encoder.encode(result);
    result = new TextDecoder().decode(bytes.slice(0, limits.maxPatchBytes));
    result += '\n... (patch truncated at byte limit)';
  }

  const finalBytes = encoder.encode(result).length;

  return {
    patch: result,
    truncated: true,
    stats: {
      originalBytes,
      finalBytes,
      originalFiles,
      includedFiles: selected.length,
    },
  };
}
