import type { JanitorConfig } from '../config/schema';
import type { ChangedFile } from '../types';
import { truncatePatch } from '../utils/limits';
import { log, warn } from '../utils/logger';
import {
  getWorkspaceChangedFiles as getWorkspaceChangedFilesShared,
  getWorkspacePatch as getWorkspacePatchShared,
} from '../utils/workspace-git';

/** Full PR context for building review prompts */
export interface PrContext {
  key: string;
  headSha: string;
  baseRef: string;
  headRef: string;
  number?: number;
  changedFiles: ChangedFile[];
  patch: string;
  patchTruncated: boolean;
}

export interface GetPrContextOpts {
  baseRef: string;
  headRef: string;
  headSha?: string;
  number?: number;
  config: JanitorConfig;
  exec: (cmd: string) => Promise<string>;
}

/**
 * Extract full PR context for a given base/head pair.
 * Handles merge-base computation and patch truncation.
 */
export async function getPrContext(opts: GetPrContextOpts): Promise<PrContext> {
  const { baseRef, headRef, config, exec } = opts;

  // Resolve head SHA
  let headSha = opts.headSha;
  if (!headSha) {
    headSha = (await exec(`git rev-parse ${headRef}`)).trim();
  }

  // Compute merge base
  let mergeBase: string;
  try {
    mergeBase = (await exec(`git merge-base ${baseRef} ${headRef}`)).trim();
  } catch (err) {
    warn(
      `[pr-context-resolver] merge-base failed, falling back to baseRef: ${err}`,
    );
    mergeBase = baseRef;
  }

  // Get changed files
  const changedFiles = await getChangedFiles(mergeBase, headRef, exec);

  // Get patch
  const patch = await getPatch(mergeBase, headRef, config, exec);

  // Build key
  const key = opts.number
    ? `pr:${opts.number}:${headSha}`
    : `branch:${headRef}:${headSha}`;

  return {
    key,
    headSha,
    baseRef,
    headRef,
    number: opts.number,
    changedFiles,
    patch: patch.content,
    patchTruncated: patch.truncated,
  };
}

/**
 * Extract review context from live workspace state.
 */
export async function getWorkspacePrContext(
  config: JanitorConfig,
  exec: (cmd: string) => Promise<string>,
): Promise<PrContext | null> {
  const headRef = (await exec('git rev-parse --abbrev-ref HEAD')).trim();
  const headSha = (await exec('git rev-parse HEAD')).trim();
  if (!headRef || headRef === 'HEAD' || !headSha) return null;

  const changedFiles = await getWorkspaceChangedFilesShared(exec);
  const patch = await getWorkspacePatchShared(
    config,
    exec,
    '[pr-context-resolver]',
  );

  return {
    key: `workspace:${headRef}:${headSha}`,
    headSha,
    baseRef: config.pr.baseBranch,
    headRef,
    changedFiles,
    patch: patch.content,
    patchTruncated: patch.truncated,
  };
}

/**
 * Get changed files between merge base and head.
 */
async function getChangedFiles(
  mergeBase: string,
  headRef: string,
  exec: (cmd: string) => Promise<string>,
): Promise<ChangedFile[]> {
  try {
    const raw = await exec(`git diff --name-status ${mergeBase}..${headRef}`);
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [status, ...pathParts] = line.split('\t');
        return { status: status || 'M', path: pathParts.join('\t') };
      });
  } catch (err) {
    warn(`[pr-context-resolver] failed to get changed files: ${err}`);
    return [];
  }
}

/**
 * Get the diff patch between merge base and head with truncation.
 */
async function getPatch(
  mergeBase: string,
  headRef: string,
  config: JanitorConfig,
  exec: (cmd: string) => Promise<string>,
): Promise<{ content: string; truncated: boolean }> {
  try {
    const raw = await exec(`git diff --no-color ${mergeBase}..${headRef}`);

    const result = truncatePatch(raw, {
      maxPatchBytes: config.diff.maxPatchBytes,
      maxFilesInPatch: config.diff.maxFilesInPatch,
      maxHunksPerFile: config.diff.maxHunksPerFile,
    });

    if (result.truncated) {
      log('[pr-context-resolver] patch truncated', {
        originalBytes: result.stats.originalBytes,
        finalBytes: result.stats.finalBytes,
        originalFiles: result.stats.originalFiles,
        includedFiles: result.stats.includedFiles,
      });
    }

    return { content: result.patch, truncated: result.truncated };
  } catch (err) {
    warn(`[pr-context-resolver] failed to get patch: ${err}`);
    return { content: '', truncated: false };
  }
}
