import {
  existsSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ReviewResult } from '../../types';
import { log, warn } from '../../utils/logger';

/**
 * Write a janitor report to the filesystem.
 * Creates the report directory if it doesn't exist.
 * Also updates a `latest.md` symlink.
 */
export async function deliverToFile(
  result: ReviewResult,
  report: string,
  reportDir: string,
  workspaceDir: string,
): Promise<void> {
  try {
    const absDir = join(workspaceDir, reportDir);

    // Ensure directory exists
    if (!existsSync(absDir)) {
      mkdirSync(absDir, { recursive: true });
    }

    // Write report file
    const shortSha = result.sha.slice(0, 7);
    const filename = `${shortSha}.md`;
    const filepath = join(absDir, filename);
    writeFileSync(filepath, report, 'utf-8');
    log(`[file-sink] wrote report: ${filepath}`);

    // Update latest.md symlink
    const latestPath = join(absDir, 'latest.md');
    try {
      if (existsSync(latestPath)) {
        unlinkSync(latestPath);
      }
      symlinkSync(filename, latestPath);
    } catch {
      // Symlinks may fail on some filesystems; not critical
      warn('[file-sink] could not create latest.md symlink');
    }
  } catch (err) {
    warn(`[file-sink] failed to write report: ${err}`);
  }
}
