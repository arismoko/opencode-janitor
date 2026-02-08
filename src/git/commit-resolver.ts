import type { JanitorConfig } from '../config/schema';
import type { ChangedFile, CommitContext } from '../types';
import { truncatePatch } from '../utils/limits';
import { log, warn } from '../utils/logger';

/** Empty tree hash for diffing initial commits */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Extract full commit context for a given SHA.
 * Handles normal, merge, and initial commits.
 */
export async function getCommitContext(
  sha: string,
  config: JanitorConfig,
  exec: (cmd: string) => Promise<string>,
): Promise<CommitContext> {
  // Get commit metadata
  const metaRaw = await exec(`git log -1 --format='%H%n%P%n%s' ${sha}`);
  const metaLines = metaRaw.trim().split('\n');
  const fullSha = metaLines[0] || sha;
  const parents = (metaLines[1] || '').split(' ').filter(Boolean);
  const subject = metaLines[2] || '';

  // Get changed files
  const changedFiles = await getChangedFiles(sha, parents, exec);

  // Get patch
  const patch = await getPatch(sha, parents, config, exec);

  return {
    sha: fullSha,
    subject,
    parents,
    changedFiles,
    patch: patch.content,
    patchTruncated: patch.truncated,
  };
}

/**
 * Extract context from the live workspace (tracked staged+unstaged + untracked).
 */
export async function getWorkspaceCommitContext(
  config: JanitorConfig,
  exec: (cmd: string) => Promise<string>,
): Promise<CommitContext> {
  const headSha = (await exec('git rev-parse HEAD')).trim();
  const branch = (await exec('git rev-parse --abbrev-ref HEAD')).trim();
  const changedFiles = await getWorkspaceChangedFiles(exec);
  const patch = await getWorkspacePatch(config, exec);

  return {
    sha: headSha,
    subject: `workspace ${branch || 'HEAD'}`,
    parents: [],
    changedFiles,
    patch: patch.content,
    patchTruncated: patch.truncated,
  };
}

/**
 * Get changed files for a commit using diff-tree.
 */
async function getChangedFiles(
  sha: string,
  parents: string[],
  exec: (cmd: string) => Promise<string>,
): Promise<ChangedFile[]> {
  try {
    const diffBase = getDiffBase(sha, parents);
    const raw = await exec(
      `git diff-tree --no-commit-id --name-status -r ${diffBase}`,
    );
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [status, ...pathParts] = line.split('\t');
        return { status: status || 'M', path: pathParts.join('\t') };
      });
  } catch (err) {
    warn(`[commit-resolver] failed to get changed files: ${err}`);
    return [];
  }
}

/**
 * Get the diff patch for a commit with truncation.
 */
async function getPatch(
  sha: string,
  parents: string[],
  config: JanitorConfig,
  exec: (cmd: string) => Promise<string>,
): Promise<{ content: string; truncated: boolean }> {
  try {
    const diffBase = getDiffBase(sha, parents);
    const raw = await exec(`git diff --no-color ${diffBase}`);

    const result = truncatePatch(raw, {
      maxPatchBytes: config.diff.maxPatchBytes,
      maxFilesInPatch: config.diff.maxFilesInPatch,
      maxHunksPerFile: config.diff.maxHunksPerFile,
    });

    if (result.truncated) {
      log('[commit-resolver] patch truncated', {
        originalBytes: result.stats.originalBytes,
        finalBytes: result.stats.finalBytes,
        originalFiles: result.stats.originalFiles,
        includedFiles: result.stats.includedFiles,
      });
    }

    return { content: result.patch, truncated: result.truncated };
  } catch (err) {
    warn(`[commit-resolver] failed to get patch: ${err}`);
    return { content: '', truncated: false };
  }
}

async function getWorkspaceChangedFiles(
  exec: (cmd: string) => Promise<string>,
): Promise<ChangedFile[]> {
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
      log('[commit-resolver] workspace patch truncated', {
        originalBytes: result.stats.originalBytes,
        finalBytes: result.stats.finalBytes,
        originalFiles: result.stats.originalFiles,
        includedFiles: result.stats.includedFiles,
      });
    }

    return { content: result.patch, truncated: result.truncated };
  } catch (err) {
    warn(`[commit-resolver] failed to get workspace patch: ${err}`);
    return { content: '', truncated: false };
  }
}

/**
 * Determine the diff base for a commit.
 * - Initial commit: diff against empty tree
 * - Normal commit: diff against first parent
 * - Merge commit: diff against first parent (first-parent mode)
 */
function getDiffBase(sha: string, parents: string[]): string {
  if (parents.length === 0) {
    // Initial commit
    return `${EMPTY_TREE}..${sha}`;
  }
  // Normal or merge: diff against first parent
  return `${parents[0]}..${sha}`;
}
