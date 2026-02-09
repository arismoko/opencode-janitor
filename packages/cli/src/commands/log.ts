/**
 * `janitor log` — print recent events from the event journal.
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import { openDatabase } from '../db/connection';
import { runMigrations } from '../db/migrations';
import { listEvents } from '../db/queries';
import { formatTs } from '../utils/time';

export function registerLogCommand(program: Command): void {
  program
    .command('log')
    .description('Show recent activity events')
    .option('-n, --limit <number>', 'Number of events to show', '25')
    .action((opts: { limit: string }) => {
      const json = program.opts()['json'] as boolean | undefined;
      try {
        const limit = Number.parseInt(opts.limit, 10);
        if (Number.isNaN(limit) || limit < 1) {
          throw new Error('--limit must be a positive integer');
        }

        const db = openDatabase();
        runMigrations(db);

        const events = listEvents(db, limit);
        db.close();

        if (json) {
          console.log(JSON.stringify(events, null, 2));
          return;
        }

        if (events.length === 0) {
          console.log(chalk.dim('No events recorded yet.'));
          return;
        }

        for (const ev of events) {
          const ts = chalk.dim(formatTs(ev.ts));
          const kind = chalk.cyan(ev.event_type);
          const level = chalk.dim(ev.level.toUpperCase());
          const repo = ev.repo_id ? chalk.dim(` repo=${ev.repo_id}`) : '';
          console.log(`${ts}  ${level}  ${kind}  ${ev.message}${repo}`);
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
