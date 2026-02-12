/**
 * `add <repo>` — add a tracked repository.
 */
import { resolve } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { openDatabase } from '../db/connection';
import { ensureSchema } from '../db/migrations';
import { appendEvent } from '../db/queries/event-queries';
import { addRepo } from '../db/queries/repo-queries';
import {
  resolveDefaultBranch,
  resolveGitDir,
  validateGitRepo,
} from '../utils/git';

export function registerAddCommand(program: Command): void {
  program
    .command('add <repo>')
    .description('Add a git repository to track for reviews')
    .action((repoArg: string) => {
      const json = program.opts()['json'] as boolean | undefined;
      try {
        const repoRoot = validateGitRepo(resolve(repoArg));
        const gitDir = resolveGitDir(repoRoot);
        const defaultBranch = resolveDefaultBranch(repoRoot);

        const db = openDatabase();
        ensureSchema(db);

        const repo = addRepo(db, { path: repoRoot, gitDir, defaultBranch });
        appendEvent(db, {
          eventType: 'repo.added',
          repoId: repo.id,
          message: `Started tracking repository ${repo.path}`,
          payload: { path: repo.path, gitDir: repo.git_dir },
        });
        db.close();

        if (json) {
          console.log(JSON.stringify(repo, null, 2));
        } else {
          console.log(
            `${chalk.green('✓')} Added ${chalk.bold(repo.path)}  id=${chalk.dim(repo.id)}`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (json) {
          console.error(JSON.stringify({ error: msg }));
        } else {
          console.error(`${chalk.red('✗')} ${msg}`);
        }
        process.exit(1);
      }
    });
}
