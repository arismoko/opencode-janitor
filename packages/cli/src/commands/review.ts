/**
 * `janitor review <repoOrId>` — trigger a manual review for a repository.
 */
import { resolve } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { openDatabase } from '../db/connection';
import { runMigrations } from '../db/migrations';
import {
  appendEvent,
  enqueueTriggerAndJob,
  findRepoByIdOrPath,
} from '../db/queries';
import { resolveHeadSha } from '../utils/git';

export function registerReviewCommand(program: Command): void {
  program
    .command('review <repoOrId>')
    .description('Trigger a manual review for a tracked repository')
    .action((repoArg: string) => {
      const json = program.opts()['json'] as boolean | undefined;
      try {
        const db = openDatabase();
        runMigrations(db);

        const normalized = resolve(repoArg);
        const repo =
          findRepoByIdOrPath(db, normalized) ?? findRepoByIdOrPath(db, repoArg);
        if (!repo) {
          throw new Error(
            `Repository not found: ${repoArg}. Use "janitor add" first.`,
          );
        }

        const sha = resolveHeadSha(repo.path);
        const subjectKey = `manual:${Date.now()}:${repo.id}`;
        const enqueued = enqueueTriggerAndJob(db, {
          repoId: repo.id,
          kind: 'manual',
          source: 'cli',
          subjectKey,
          payload: { sha, manual: true },
        });

        if (enqueued) {
          appendEvent(db, {
            eventType: 'review.enqueued',
            repoId: repo.id,
            message: `Manual review enqueued for ${sha.slice(0, 10)}`,
            level: 'info',
            payload: { sha, subjectKey },
          });
        }

        db.close();

        if (json) {
          console.log(
            JSON.stringify({ enqueued, repoId: repo.id, sha, subjectKey }),
          );
          return;
        }

        if (enqueued) {
          console.log(
            `${chalk.green('✓')} Review enqueued for ${chalk.bold(repo.path)} at ${chalk.dim(sha.slice(0, 10))}`,
          );
        } else {
          console.log(
            `${chalk.yellow('⚠')} Review already queued for ${chalk.bold(repo.path)} at ${chalk.dim(sha.slice(0, 10))}`,
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
