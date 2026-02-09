/**
 * `janitor review <repoOrId>` — trigger a manual review for a repository.
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader';
import { requestJson } from '../ipc/client';
import type { EnqueueReviewResponse, ErrorResponse } from '../ipc/protocol';

export function registerReviewCommand(program: Command): void {
  program
    .command('review <repoOrId>')
    .description('Trigger a manual review for a tracked repository')
    .action(async (repoArg: string) => {
      const rootOptions = program.opts<{ json?: boolean; config?: string }>();
      const json = rootOptions.json;
      try {
        const config = loadConfig(rootOptions.config);
        const response = await requestJson<
          EnqueueReviewResponse | ErrorResponse
        >({
          socketPath: config.daemon.socketPath,
          path: '/v1/reviews/enqueue',
          method: 'POST',
          body: { repoOrId: repoArg },
          timeoutMs: 4000,
        });

        if (response.status !== 200) {
          const err = response.data as ErrorResponse;
          const message = err.error?.message ?? 'Failed to enqueue review';
          throw new Error(message);
        }

        const payload = response.data as EnqueueReviewResponse;

        const { enqueued, repoId, repoPath, sha, subjectKey } = payload;

        if (json) {
          console.log(
            JSON.stringify({ enqueued, repoId, repoPath, sha, subjectKey }),
          );
          return;
        }

        if (enqueued) {
          console.log(
            `${chalk.green('✓')} Review enqueued for ${chalk.bold(repoPath)} at ${chalk.dim(sha.slice(0, 10))}`,
          );
        } else {
          console.log(
            `${chalk.yellow('⚠')} Review already queued for ${chalk.bold(repoPath)} at ${chalk.dim(sha.slice(0, 10))}`,
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
