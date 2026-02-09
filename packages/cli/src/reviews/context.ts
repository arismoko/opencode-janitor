/**
 * Build commit review context from repo path + SHA using git commands.
 */
import {
  type ChangedFile,
  type CommitContext,
  extractHeadSha,
  parseReviewKey,
} from '@opencode-janitor/shared';
import { resolveHeadSha } from '../utils/git';

const MAX_PATCH_CHARS = 200_000;

function runGit(cwd: string, args: string[]) {
  const proc = Bun.spawnSync({
    cmd: ['git', '-C', cwd, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    stdout: proc.stdout.toString('utf8').trim(),
    stderr: proc.stderr.toString('utf8').trim(),
    exitCode: proc.exitCode,
  };
}

/**
 * Build full commit context for a given SHA.
 * Runs git commands to collect subject, parents, changed files, and diff patch.
 */
export function buildCommitContext(
  repoPath: string,
  sha: string,
): CommitContext {
  const subject = runGit(repoPath, ['log', '-1', '--format=%s', sha]).stdout;

  const parentsRaw = runGit(repoPath, ['log', '-1', '--format=%P', sha]).stdout;
  const parents = parentsRaw ? parentsRaw.split(' ') : [];

  const filesRaw = runGit(repoPath, [
    'diff-tree',
    '--no-commit-id',
    '-r',
    '--name-status',
    sha,
  ]).stdout;
  const changedFiles: ChangedFile[] = filesRaw
    ? filesRaw.split('\n').map((line) => {
        const [status, ...rest] = line.split('\t');
        return { status: status!, path: rest.join('\t') };
      })
    : [];

  const deletionOnly =
    changedFiles.length > 0 && changedFiles.every((f) => f.status === 'D');

  let patch = runGit(repoPath, ['diff-tree', '-p', sha]).stdout;
  let patchTruncated = false;
  if (patch.length > MAX_PATCH_CHARS) {
    patch = patch.slice(0, MAX_PATCH_CHARS);
    patchTruncated = true;
  }

  return {
    sha,
    subject,
    parents,
    changedFiles,
    patch,
    patchTruncated,
    deletionOnly,
  };
}

/**
 * Resolve the commit SHA from a trigger's subject_key.
 * Falls back to HEAD if the key is unrecognised.
 */
export function resolveCommitSha(repoPath: string, subjectKey: string): string {
  const headSha = extractHeadSha(subjectKey);
  if (headSha) return headSha;

  // Unrecognised key format — fall back to current HEAD
  return resolveHeadSha(repoPath);
}
