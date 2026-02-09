/**
 * Build review context from repo path + trigger subject key.
 *
 * Validates subject keys via the shared parseReviewKey parser and throws
 * explicit errors on malformed/unresolved keys. No fallback-to-HEAD.
 */
import {
  type ChangedFile,
  type CommitContext,
  parseReviewKey,
} from '@opencode-janitor/shared';
import type { TriggerContext } from '../runtime/agent-runtime-spec';

const MAX_PATCH_CHARS = 200_000;

function runGit(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync({
    cmd: ['git', '-C', cwd, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = proc.stdout.toString('utf8').trim();
  const stderr = proc.stderr.toString('utf8').trim();
  if (proc.exitCode !== 0) {
    const command = ['git', '-C', cwd, ...args].join(' ');
    const details = stderr || stdout || 'no output';
    throw new Error(
      `Git command failed (${proc.exitCode}): ${command}\n${details}`,
    );
  }

  return stdout;
}

/**
 * Build full commit context for a given SHA.
 * Runs git commands to collect subject, parents, changed files, and diff patch.
 */
export function buildCommitContext(
  repoPath: string,
  sha: string,
): CommitContext {
  const subject = runGit(repoPath, ['log', '-1', '--format=%s', sha]);

  const parentsRaw = runGit(repoPath, ['log', '-1', '--format=%P', sha]);
  const parents = parentsRaw ? parentsRaw.split(' ') : [];

  const filesRaw = runGit(repoPath, [
    'diff-tree',
    '--no-commit-id',
    '-r',
    '--name-status',
    sha,
  ]);
  const changedFiles: ChangedFile[] = filesRaw
    ? filesRaw.split('\n').map((line) => {
        const [status, ...rest] = line.split('\t');
        return { status: status!, path: rest.join('\t') };
      })
    : [];

  const deletionOnly =
    changedFiles.length > 0 && changedFiles.every((f) => f.status === 'D');

  let patch = runGit(repoPath, ['diff-tree', '-p', sha]);
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
 * Throws on malformed or unrecognised keys — no fallback to HEAD.
 */
export function resolveCommitSha(
  _repoPath: string,
  subjectKey: string,
): string {
  const parsed = parseReviewKey(subjectKey);
  if (!parsed) {
    throw new Error(
      `Malformed subject key: "${subjectKey}" — expected commit:<sha>, pr:<n>:<sha>, branch:<name>:<sha>, workspace:<name>:<sha>, or manual:<id>:<sha>`,
    );
  }
  return parsed.type === 'commit' ? parsed.sha : parsed.headSha;
}

/**
 * Build a trigger-discriminated context object from a job's subject key
 * and payload. Validates the key and builds commit context as needed.
 *
 * Throws on malformed/unresolved keys (fail-closed).
 */
export function buildTriggerContext(
  repoPath: string,
  subjectKey: string,
  payloadSha: string | null,
): TriggerContext {
  const parsed = parseReviewKey(subjectKey);
  if (!parsed) {
    throw new Error(
      `Malformed subject key: "${subjectKey}" — expected commit:<sha>, pr:<n>:<sha>, branch:<name>:<sha>, workspace:<name>:<sha>, or manual:<id>:<sha>`,
    );
  }

  const sha =
    payloadSha ?? (parsed.type === 'commit' ? parsed.sha : parsed.headSha);

  if (parsed.type === 'manual') {
    return { kind: 'manual', commitSha: sha };
  }

  const commitContext = buildCommitContext(repoPath, sha);

  switch (parsed.type) {
    case 'commit':
    case 'branch':
    case 'workspace':
      return { kind: 'commit', commitSha: sha, commitContext };

    case 'pr':
      return {
        kind: 'pr',
        commitSha: sha,
        commitContext,
        prNumber: parsed.number,
      };
  }
}
