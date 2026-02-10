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
import { resolveDefaultBranch } from '../utils/git';

const MAX_PATCH_CHARS = 200_000;

function runGitWithAllowedExitCodes(
  cwd: string,
  args: string[],
  allowedExitCodes: number[],
): string {
  const proc = Bun.spawnSync({
    cmd: ['git', '-C', cwd, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = proc.stdout.toString('utf8').trim();
  const stderr = proc.stderr.toString('utf8').trim();
  if (!allowedExitCodes.includes(proc.exitCode)) {
    const command = ['git', '-C', cwd, ...args].join(' ');
    const details = stderr || stdout || 'no output';
    throw new Error(
      `Git command failed (${proc.exitCode}): ${command}\n${details}`,
    );
  }

  return stdout;
}

function runGit(cwd: string, args: string[]): string {
  return runGitWithAllowedExitCodes(cwd, args, [0]);
}

function runGh(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync({
    cmd: ['gh', ...args],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = proc.stdout.toString('utf8').trim();
  const stderr = proc.stderr.toString('utf8').trim();
  if (proc.exitCode !== 0) {
    const command = ['gh', ...args].join(' ');
    const details = stderr || stdout || 'no output';
    throw new Error(
      `GitHub command failed (${proc.exitCode}): ${command}\n${details}`,
    );
  }

  return stdout;
}

function parseNameStatus(linesRaw: string): ChangedFile[] {
  if (!linesRaw) return [];

  return linesRaw.split('\n').map((line) => {
    const [statusRaw, ...rest] = line.split('\t');
    const status = statusRaw ?? 'M';
    const path = rest.length > 1 ? rest[rest.length - 1]! : (rest[0] ?? '');
    return { status, path };
  });
}

function parsePorcelainStatus(linesRaw: string): {
  changedFiles: ChangedFile[];
  untrackedPaths: string[];
} {
  if (!linesRaw) {
    return { changedFiles: [], untrackedPaths: [] };
  }

  const changedFiles: ChangedFile[] = [];
  const untrackedPaths: string[] = [];

  for (const line of linesRaw.split('\n')) {
    if (line.length < 3) continue;

    const indexStatus = line[0] ?? ' ';
    const worktreeStatus = line[1] ?? ' ';
    const rawPath = line.slice(3);
    const path = rawPath.includes(' -> ')
      ? (rawPath.split(' -> ').at(-1) ?? rawPath)
      : rawPath;

    if (indexStatus === '?' && worktreeStatus === '?') {
      changedFiles.push({ status: 'A', path });
      untrackedPaths.push(path);
      continue;
    }

    const normalized =
      indexStatus !== ' ' && indexStatus !== '?'
        ? indexStatus
        : worktreeStatus !== ' ' && worktreeStatus !== '?'
          ? worktreeStatus
          : 'M';
    changedFiles.push({ status: normalized, path });
  }

  return { changedFiles, untrackedPaths };
}

function collectUntrackedPatch(
  repoPath: string,
  untrackedPaths: string[],
): string {
  if (untrackedPaths.length === 0) return '';

  const chunks: string[] = [];
  for (const relativePath of untrackedPaths) {
    const patch = runGitWithAllowedExitCodes(
      repoPath,
      ['diff', '--no-index', '--', '/dev/null', relativePath],
      [0, 1],
    );
    if (patch) chunks.push(patch);
  }
  return chunks.join('\n');
}

function truncatePatch(patch: string): {
  patch: string;
  patchTruncated: boolean;
} {
  if (patch.length > MAX_PATCH_CHARS) {
    return {
      patch: patch.slice(0, MAX_PATCH_CHARS),
      patchTruncated: true,
    };
  }
  return { patch, patchTruncated: false };
}

function buildWorkspaceCommitContext(
  repoPath: string,
  sha: string,
): CommitContext {
  const branch =
    runGitWithAllowedExitCodes(
      repoPath,
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      [0],
    ) || 'detached';
  const statusRaw = runGit(repoPath, ['status', '--porcelain=v1', '-uall']);
  const { changedFiles, untrackedPaths } = parsePorcelainStatus(statusRaw);
  const deletionOnly =
    changedFiles.length > 0 && changedFiles.every((f) => f.status === 'D');

  const trackedPatch = runGitWithAllowedExitCodes(
    repoPath,
    ['diff', '--no-color', 'HEAD'],
    [0],
  );
  const untrackedPatch = collectUntrackedPatch(repoPath, untrackedPaths);
  const combinedPatch = [trackedPatch, untrackedPatch]
    .filter(Boolean)
    .join('\n');
  const { patch, patchTruncated } = truncatePatch(combinedPatch);

  return {
    sha,
    subject: `workspace ${branch}`,
    parents: [],
    changedFiles,
    patch,
    patchTruncated,
    deletionOnly,
  };
}

function resolvePrBaseHeadRefs(
  repoPath: string,
  prNumber: number,
): { baseRef: string; headRef: string } {
  try {
    const output = runGh(repoPath, [
      'pr',
      'view',
      String(prNumber),
      '--json',
      'baseRefName,headRefName',
      '--jq',
      '.baseRefName + "\\n" + .headRefName',
    ]);
    const [baseRef, headRef] = output.split('\n');
    if (baseRef && headRef) {
      return { baseRef, headRef };
    }
  } catch {
    // Fall through to deterministic local fallback.
  }

  const baseRef = resolveDefaultBranch(repoPath);
  return { baseRef, headRef: 'HEAD' };
}

function buildPrCommitContext(
  repoPath: string,
  headSha: string,
  prNumber: number,
): CommitContext {
  const { baseRef, headRef } = resolvePrBaseHeadRefs(repoPath, prNumber);
  let mergeBase: string;
  try {
    mergeBase = runGit(repoPath, ['merge-base', baseRef, headSha]);
  } catch {
    mergeBase = runGit(repoPath, ['merge-base', `origin/${baseRef}`, headSha]);
  }
  const range = `${mergeBase}..${headSha}`;

  const changedFilesRaw = runGit(repoPath, ['diff', '--name-status', range]);
  const changedFiles = parseNameStatus(changedFilesRaw);
  const deletionOnly =
    changedFiles.length > 0 && changedFiles.every((f) => f.status === 'D');

  const patchRaw = runGit(repoPath, ['diff', '--no-color', range]);
  const { patch, patchTruncated } = truncatePatch(patchRaw);

  return {
    sha: headSha,
    subject: `PR #${prNumber} ${baseRef}..${headRef}`,
    parents: [mergeBase],
    changedFiles,
    patch,
    patchTruncated,
    deletionOnly,
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
  const changedFiles = parseNameStatus(filesRaw);

  const deletionOnly =
    changedFiles.length > 0 && changedFiles.every((f) => f.status === 'D');

  const patchRaw = runGit(repoPath, ['diff-tree', '-p', sha]);
  const { patch, patchTruncated } = truncatePatch(patchRaw);

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
    return {
      kind: 'manual',
      commitSha: sha,
      commitContext: buildWorkspaceCommitContext(repoPath, sha),
    };
  }

  switch (parsed.type) {
    case 'commit':
    case 'branch':
    case 'workspace':
      return {
        kind: 'commit',
        commitSha: sha,
        commitContext: buildCommitContext(repoPath, sha),
      };

    case 'pr':
      return {
        kind: 'pr',
        commitSha: sha,
        commitContext: buildPrCommitContext(repoPath, sha, parsed.number),
        prNumber: parsed.number,
      };
  }
}
