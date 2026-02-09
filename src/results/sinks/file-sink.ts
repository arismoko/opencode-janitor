import {
  existsSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { EnrichmentData } from '../../history/enrichment';
import { buildHistorySection } from '../../history/enrichment';
import { log, warn } from '../../utils/logger';

export interface FileDeliveryOptions {
  /** Short identifier used as filename (e.g. sha, pr id) */
  fileId: string;
  /** Report directory relative to workspace */
  reportDir: string;
  /** Workspace root directory */
  workspaceDir: string;
  /** Optional enrichment data appended as history section */
  enrichment?: EnrichmentData;
}

/**
 * Write a report to the filesystem.
 *
 * Unified sink replacing both `deliverToFile` and `deliverReviewerToFile`.
 * Creates the report directory if it doesn't exist and updates a `latest.md` symlink.
 */
export async function deliverToFile(
  report: string,
  opts: FileDeliveryOptions,
): Promise<void> {
  try {
    const absDir = resolve(opts.workspaceDir, opts.reportDir);
    const normalizedRoot = resolve(opts.workspaceDir) + sep;
    if (
      !absDir.startsWith(normalizedRoot) &&
      absDir !== resolve(opts.workspaceDir)
    ) {
      warn(`[file-sink] reportDir escapes workspace: ${opts.reportDir}`);
      return;
    }

    // Ensure directory exists
    if (!existsSync(absDir)) {
      mkdirSync(absDir, { recursive: true });
    }

    // Write report file
    const filename = `${opts.fileId}.md`;
    const filepath = join(absDir, filename);
    const historySection = opts.enrichment
      ? buildHistorySection(opts.enrichment)
      : '';
    const fullReport = report + historySection;
    writeFileSync(filepath, fullReport, 'utf-8');
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
