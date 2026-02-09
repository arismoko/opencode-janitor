/**
 * `janitor remove <repoOrId>` — remove a tracked repository.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { openDatabase } from '../db/connection';
import { runMigrations } from '../db/migrations';
import { appendEvent, removeRepoByIdOrPath } from '../db/queries';

export function registerRemoveCommand(program: Command): void {
  program
    .command('remove <repoOrId>')
    .description('Remove a tracked repository by ID or path')
    .action((repoOrId: string) => {
      const json = program.opts()['json'] as boolean | undefined;
      try {
        const asPath = resolve(repoOrId);
        const lookup = existsSync(asPath) ? asPath : repoOrId;

        const db = openDatabase();
        runMigrations(db);

        const removed = removeRepoByIdOrPath(db, lookup);
        if (!removed) {
          db.close();
          const msg = `No tracked repo found for: ${repoOrId}`;
          if (json) {
            console.error(JSON.stringify({ error: msg }));
          } else {
            console.error(`${chalk.red('✗')} ${msg}`);
          }
          process.exit(1);
          return;
        }

        appendEvent(db, {
          eventType: 'repo.removed',
          repoId: removed.id,
          message: `Stopped tracking repository ${removed.path}`,
          payload: { path: removed.path },
        });
        db.close();

        if (json) {
          console.log(JSON.stringify(removed, null, 2));
        } else {
          console.log(
            `${chalk.green('✓')} Removed ${chalk.bold(removed.path)}`,
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
