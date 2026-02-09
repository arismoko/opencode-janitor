/**
 * Git workspace inspection utilities.
 */
import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runGit(cwd: string, args: string[]): GitResult {
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
 * Validate that the given path is inside a git working tree.
 * Returns the absolute path to the repository root.
 */
export function validateGitRepo(repoPath: string): string {
  const absPath = resolve(repoPath);

  if (!existsSync(absPath)) {
    throw new Error(`Path does not exist: ${absPath}`);
  }

  if (!statSync(absPath).isDirectory()) {
    throw new Error(`Not a directory: ${absPath}`);
  }

  const result = runGit(absPath, ['rev-parse', '--show-toplevel']);
  if (result.exitCode !== 0 || !result.stdout) {
    throw new Error(`Not a git repository: ${absPath}`);
  }

  return result.stdout;
}

/** Resolve the absolute .git directory for a repository. */
export function resolveGitDir(repoPath: string): string {
  const result = runGit(repoPath, ['rev-parse', '--absolute-git-dir']);
  if (result.exitCode !== 0 || !result.stdout) {
    throw new Error(`Failed to resolve .git dir for repository: ${repoPath}`);
  }

  return result.stdout;
}

/**
 * Resolve the default branch for the repository.
 * Tries origin HEAD first, then falls back to current checked-out branch.
 */
export function resolveDefaultBranch(repoPath: string): string {
  const originHead = runGit(repoPath, [
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
  ]);

  if (originHead.exitCode === 0 && originHead.stdout) {
    const segments = originHead.stdout.split('/');
    const branch = segments[segments.length - 1];
    if (branch) {
      return branch;
    }
  }

  const current = runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (current.exitCode === 0 && current.stdout && current.stdout !== 'HEAD') {
    return current.stdout;
  }

  return 'main';
}

/** Get the repository name from its path. */
export function repoNameFromPath(repoPath: string): string {
  return basename(repoPath);
}

/** Resolve the current HEAD SHA for a repository. */
export function resolveHeadSha(repoPath: string): string {
  const result = runGit(repoPath, ['rev-parse', 'HEAD']);
  if (result.exitCode !== 0 || !result.stdout) {
    throw new Error(`Failed to resolve HEAD SHA for repository: ${repoPath}`);
  }

  return result.stdout;
}

/**
 * Resolve the open PR key for the current branch.
 * Returns `<number>:<headSha>` or null if no PR is available.
 */
export function resolveCurrentPrKey(repoPath: string): string | null {
  const proc = Bun.spawnSync({
    cmd: [
      'gh',
      'pr',
      'view',
      '--json',
      'number,headRefOid',
      '--jq',
      '.number | tostring + ":" + .headRefOid',
    ],
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (proc.exitCode !== 0) {
    return null;
  }

  const value = proc.stdout.toString('utf8').trim();
  return value || null;
}
