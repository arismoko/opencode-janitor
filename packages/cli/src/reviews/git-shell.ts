import {
  type GitCommandResult,
  ghCliEnv,
  runGitCommand as runGitCommandShared,
} from '../utils/git';

export type { GitCommandResult } from '../utils/git';

export function runGitCommand(cwd: string, args: string[]): GitCommandResult {
  return runGitCommandShared(cwd, args, { trimOutput: false });
}

export function runGitWithAllowedExitCodes(
  cwd: string,
  args: string[],
  allowedExitCodes: number[],
  options?: { trimOutput?: boolean },
): string {
  const result = runGitCommand(cwd, args);
  const stdout =
    options?.trimOutput === false ? result.stdout : result.stdout.trim();
  const stderr = result.stderr.trim();
  if (!allowedExitCodes.includes(result.exitCode)) {
    const command = ['git', '-C', cwd, ...args].join(' ');
    const details = stderr || stdout || 'no output';
    throw new Error(
      `Git command failed (${result.exitCode}): ${command}\n${details}`,
    );
  }

  return stdout;
}

export function runGit(cwd: string, args: string[]): string {
  return runGitWithAllowedExitCodes(cwd, args, [0]);
}

export function runGh(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync({
    cmd: ['gh', ...args],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: ghCliEnv(),
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
