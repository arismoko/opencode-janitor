import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { log } from '../utils/logger';

/**
 * Resolve the actual .git directory for a workspace.
 * Handles:
 * - Regular repos: .git is a directory
 * - Worktrees: .git is a file pointing to the real git dir
 */
export async function resolveGitDir(
  directory: string,
  exec: (cmd: string) => Promise<string>,
): Promise<string> {
  const dotGit = join(directory, '.git');

  if (!existsSync(dotGit)) {
    // Try git rev-parse as fallback
    try {
      const result = await exec('git rev-parse --git-dir');
      const gitDir = resolve(directory, result.trim());
      log(`[repo-locator] resolved via rev-parse: ${gitDir}`);
      return gitDir;
    } catch {
      throw new Error(`No .git found in ${directory}`);
    }
  }

  const stat = statSync(dotGit);

  if (stat.isDirectory()) {
    log(`[repo-locator] standard .git directory: ${dotGit}`);
    return dotGit;
  }

  // Worktree: .git is a file like "gitdir: /path/to/.git/worktrees/name"
  if (stat.isFile()) {
    const content = readFileSync(dotGit, 'utf-8').trim();
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (match) {
      const gitDir = resolve(directory, match[1]);
      log(`[repo-locator] worktree .git file points to: ${gitDir}`);
      return gitDir;
    }
  }

  throw new Error(`Unexpected .git format in ${directory}`);
}
