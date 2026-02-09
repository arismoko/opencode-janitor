import type { JanitorConfig } from '../config/schema';
import { truncatePatch } from './limits';
import { log, warn } from './logger';

/** Single-quoted shell token with escaped single quotes. */
export function shellEscapeQuoted(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Get changed files from the live workspace using git status --porcelain.
 * Returns an array of {status, path} entries.
 */
export async function getWorkspaceChangedFiles(
  exec: (cmd: string) => Promise<string>,
): Promise<Array<{ status: string; path: string }>> {
  try {
    const raw = await exec('git status --porcelain=v1 -uall');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const x = line[0] ?? ' ';
        const y = line[1] ?? ' ';
        const rest = line.slice(3).trim();
        const path = rest.includes(' -> ') ? rest.split(' -> ')[1] : rest;
        const status = x === '?' || y === '?' ? 'A' : x !== ' ' ? x : y;
        return { status: status || 'M', path };
      })
      .filter((f) => f.path);
  } catch {
    return [];
  }
}

/**
 * Get the full workspace diff patch (tracked + untracked) with truncation.
 * @param logPrefix - prefix for log messages, e.g. '[commit-resolver]'
 */
export async function getWorkspacePatch(
  config: JanitorConfig,
  exec: (cmd: string) => Promise<string>,
  logPrefix: string,
): Promise<{ content: string; truncated: boolean }> {
  try {
    let raw = await exec('git diff --no-color HEAD');
    const untracked = await exec('git ls-files --others --exclude-standard');
    for (const path of untracked.trim().split('\n').filter(Boolean)) {
      const addPatch = await exec(
        `git diff --no-color --no-index -- /dev/null ${shellEscapeQuoted(path)} || true`,
      );
      raw = raw ? `${raw}\n${addPatch}` : addPatch;
    }

    const result = truncatePatch(raw, {
      maxPatchBytes: config.diff.maxPatchBytes,
      maxFilesInPatch: config.diff.maxFilesInPatch,
      maxHunksPerFile: config.diff.maxHunksPerFile,
    });

    if (result.truncated) {
      log(`${logPrefix} workspace patch truncated`, {
        originalBytes: result.stats.originalBytes,
        finalBytes: result.stats.finalBytes,
        originalFiles: result.stats.originalFiles,
        includedFiles: result.stats.includedFiles,
      });
    }

    return { content: result.patch, truncated: result.truncated };
  } catch (err) {
    warn(`${logPrefix} failed to get workspace patch: ${err}`);
    return { content: '', truncated: false };
  }
}
