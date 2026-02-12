/**
 * Git workspace inspection utilities.
 */
import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runGitWithAllowedExitCodes(
  cwd: string,
  args: string[],
  allowedExitCodes: number[],
  options?: { trimOutput?: boolean },
): string {
  const result = runGitCommand(cwd, args, options);
  if (!allowedExitCodes.includes(result.exitCode)) {
    const command = ['git', '-C', cwd, ...args].join(' ');
    const details = result.stderr || result.stdout || 'no output';
    throw new Error(
      `Git command failed (${result.exitCode}): ${command}\n${details}`,
    );
  }
  return result.stdout;
}

export function runGhCommand(
  cwd: string,
  args: string[],
  options?: { trimOutput?: boolean },
): GitCommandResult {
  const proc = Bun.spawnSync({
    cmd: ['gh', ...args],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: ghCliEnv(),
  });

  const trimOutput = options?.trimOutput !== false;
  const stdoutRaw = proc.stdout.toString('utf8');
  const stderrRaw = proc.stderr.toString('utf8');

  return {
    stdout: trimOutput ? stdoutRaw.trim() : stdoutRaw,
    stderr: trimOutput ? stderrRaw.trim() : stderrRaw,
    exitCode: proc.exitCode,
  };
}

export function runGitCommand(
  cwd: string,
  args: string[],
  options?: { trimOutput?: boolean },
): GitCommandResult {
  const proc = Bun.spawnSync({
    cmd: ['git', '-C', cwd, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const trimOutput = options?.trimOutput !== false;
  const stdoutRaw = proc.stdout.toString('utf8');
  const stderrRaw = proc.stderr.toString('utf8');

  return {
    stdout: trimOutput ? stdoutRaw.trim() : stdoutRaw,
    stderr: trimOutput ? stderrRaw.trim() : stderrRaw,
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

  const result = runGitCommand(absPath, ['rev-parse', '--show-toplevel']);
  if (result.exitCode !== 0 || !result.stdout) {
    throw new Error(`Not a git repository: ${absPath}`);
  }

  return result.stdout;
}

/** Resolve the absolute .git directory for a repository. */
export function resolveGitDir(repoPath: string): string {
  const result = runGitCommand(repoPath, ['rev-parse', '--absolute-git-dir']);
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
  const originHead = runGitCommand(repoPath, [
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

  const current = runGitCommand(repoPath, [
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ]);
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
  const result = runGitCommand(repoPath, ['rev-parse', 'HEAD']);
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
      'number,headRefOid,state',
      '--jq',
      'select(.state == "OPEN") | (.number | tostring) + ":" + .headRefOid',
    ],
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
    env: ghCliEnv(),
  });

  if (proc.exitCode !== 0) {
    return null;
  }

  const value = proc.stdout.toString('utf8').trim();
  return value || null;
}

// ---------------------------------------------------------------------------
// Async probe helpers (P1.6 detector scalability)
// ---------------------------------------------------------------------------

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

/** GitHub CLI env — disables interactive prompts to prevent daemon hangs. */
export function ghCliEnv(): Record<string, string | undefined> {
  return { ...process.env, GH_PROMPT_DISABLED: '1' };
}

interface AsyncGitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runGitAsync(
  cwd: string,
  args: string[],
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<AsyncGitResult> {
  const proc = Bun.spawn({
    cmd: ['git', '-C', cwd, ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timer = setTimeout(() => {
    proc.kill();
  }, timeoutMs);

  try {
    const exitCode = await proc.exited;
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  } finally {
    clearTimeout(timer);
  }
}

async function runGhAsync(
  cwd: string,
  args: string[],
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<AsyncGitResult> {
  const proc = Bun.spawn({
    cmd: ['gh', ...args],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: ghCliEnv(),
  });

  const timer = setTimeout(() => {
    proc.kill();
  }, timeoutMs);

  try {
    const exitCode = await proc.exited;
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  } finally {
    clearTimeout(timer);
  }
}

/** Async version of resolveHeadSha with timeout support. */
export async function resolveHeadShaAsync(
  repoPath: string,
  timeoutMs?: number,
): Promise<string> {
  const result = await runGitAsync(repoPath, ['rev-parse', 'HEAD'], timeoutMs);
  if (result.exitCode !== 0 || !result.stdout) {
    throw new Error(`Failed to resolve HEAD SHA for repository: ${repoPath}`);
  }

  return result.stdout;
}

/**
 * Async version of resolveCurrentPrKey with timeout support.
 * Returns `<number>:<headSha>` or null if no PR is available.
 */
export async function resolveCurrentPrKeyAsync(
  repoPath: string,
  timeoutMs?: number,
): Promise<string | null> {
  const result = await runGhAsync(
    repoPath,
    [
      'pr',
      'view',
      '--json',
      'number,headRefOid,state',
      '--jq',
      'select(.state == "OPEN") | (.number | tostring) + ":" + .headRefOid',
    ],
    timeoutMs,
  );

  if (result.exitCode === 0) {
    return result.stdout || null;
  }

  // exit 1 = no PR for current branch (expected, not an error)
  if (result.exitCode === 1) {
    return null;
  }

  // exit > 1 = gh CLI error (auth, network, rate limit) — surface as throw
  // so probePr logs a detector.error event instead of silently treating as "no PR"
  throw new Error(
    `gh pr view failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200) || 'no stderr'}`,
  );
}

/**
 * Resolve the HEAD SHA of a specific PR number from GitHub.
 *
 * Used when a manual `--pr` flag is given so the review key references the
 * actual PR head commit, not the local working tree HEAD.
 */
export async function resolvePrHeadShaAsync(
  repoPath: string,
  prNumber: number,
  timeoutMs?: number,
): Promise<string> {
  const result = await runGhAsync(
    repoPath,
    [
      'pr',
      'view',
      String(prNumber),
      '--json',
      'headRefOid',
      '--jq',
      '.headRefOid',
    ],
    timeoutMs,
  );

  if (result.exitCode !== 0 || !result.stdout) {
    throw new Error(
      `Failed to resolve head SHA for PR #${prNumber}: ${result.stderr.slice(0, 200) || 'no output'}`,
    );
  }

  return result.stdout;
}
