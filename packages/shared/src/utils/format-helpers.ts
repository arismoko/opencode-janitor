import type { ChangedFile } from '../types/review';

/**
 * Create a short summary from a location string.
 * e.g., "src/utils/helper.ts:42" → "helper.ts"
 */
export function summarizeLocation(location: string): string {
  const filePart = location.split(':')[0];
  const segments = filePart.split('/');
  return segments[segments.length - 1] || filePart;
}

/**
 * Format changed files into a tab-separated status+path list.
 * Shared by prompt builders.
 */
export function formatChangedFiles(files: ChangedFile[]): string {
  return files.map((f) => `  ${f.status}\t${f.path}`).join('\n');
}
