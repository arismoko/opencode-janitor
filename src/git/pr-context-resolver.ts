import type { JanitorConfig } from '../config/schema';
import { truncatePatch } from '../utils/limits';
import { log, warn } from '../utils/logger';

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Changed file entry from git diff */
export interface PrChangedFile {
  status: string;
  path: string;
}

/** Full PR context for building review prompts */
export interface PrContext {
  key: string;
  headSha: string;
  baseRef: string;
  headRef: string;
  number?: number;
  changedFiles: PrChangedFile[];
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

  const changedFiles = await getWorkspaceChangedFiles(exec);
  const patch = await getWorkspacePatch(config, exec);

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
): Promise<PrChangedFile[]> {
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

async function getWorkspaceChangedFiles(
  exec: (cmd: string) => Promise<string>,
): Promise<PrChangedFile[]> {
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

async function getWorkspacePatch(
  config: JanitorConfig,
  exec: (cmd: string) => Promise<string>,
): Promise<{ content: string; truncated: boolean }> {
  try {
    let raw = await exec('git diff --no-color HEAD');
    const untracked = await exec('git ls-files --others --exclude-standard');
    for (const path of untracked.trim().split('\n').filter(Boolean)) {
      const addPatch = await exec(
        `git diff --no-color --no-index -- /dev/null ${shellEscape(path)} || true`,
      );
      raw = raw ? `${raw}\n${addPatch}` : addPatch;
    }

    const result = truncatePatch(raw, {
      maxPatchBytes: config.diff.maxPatchBytes,
      maxFilesInPatch: config.diff.maxFilesInPatch,
      maxHunksPerFile: config.diff.maxHunksPerFile,
    });

    if (result.truncated) {
      log('[pr-context-resolver] workspace patch truncated', {
        originalBytes: result.stats.originalBytes,
        finalBytes: result.stats.finalBytes,
        originalFiles: result.stats.originalFiles,
        includedFiles: result.stats.includedFiles,
      });
    }

    return { content: result.patch, truncated: result.truncated };
  } catch (err) {
    warn(`[pr-context-resolver] failed to get workspace patch: ${err}`);
    return { content: '', truncated: false };
  }
}
