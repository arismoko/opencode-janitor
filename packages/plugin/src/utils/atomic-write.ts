import { renameSync, writeFileSync } from 'node:fs';

/**
 * Write a file atomically using write-then-rename.
 *
 * Writes to a `.tmp` sibling first, then renames to the final path.
 * `renameSync` is atomic on POSIX filesystems, so the target file
 * is never left in a truncated/invalid state if the process crashes.
 */
export function atomicWriteSync(filePath: string, data: string): void {
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, data, 'utf-8');
  renameSync(tmp, filePath);
}
