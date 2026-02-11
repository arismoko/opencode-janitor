/**
 * `janitor log` — print recent events from the event journal.
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader';
import { openDatabase } from '../db/connection';
import { ensureSchema } from '../db/migrations';
import { listEvents } from '../db/queries';
import { requestSse } from '../ipc/client';
import { toEventEntry } from '../ipc/event-entry';
import type { EventJournalEntry } from '../ipc/protocol';
import { formatTs } from '../utils/time';

function printEvent(event: EventJournalEntry): void {
  const ts = chalk.dim(formatTs(event.ts));
  const kind = chalk.cyan(event.topic);
  const level = chalk.dim(event.level.toUpperCase());
  const repo = event.repoId ? chalk.dim(` repo=${event.repoId}`) : '';
  console.log(`${ts}  ${level}  ${kind}  ${event.message}${repo}`);
}

function readRecentEvents(limit: number): EventJournalEntry[] {
  const db = openDatabase();
  ensureSchema(db);
  const rows = listEvents(db, limit);
  db.close();
  return rows.map((row) => toEventEntry(row));
}

async function followEvents(
  socketPath: string,
  afterSeq: number,
  json: boolean,
): Promise<void> {
  const controller = new AbortController();
  const onSigint = () => {
    controller.abort();
  };

  process.on('SIGINT', onSigint);

  try {
    await requestSse({
      socketPath,
      path: `/v1/events/stream?afterSeq=${afterSeq}`,
      signal: controller.signal,
      onEvent: (event, payload) => {
        if (event !== 'event') {
          return;
        }

        const row = payload as EventJournalEntry;
        if (json) {
          console.log(JSON.stringify(row));
          return;
        }

        printEvent(row);
      },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    throw error;
  } finally {
    process.off('SIGINT', onSigint);
  }
}

export function registerLogCommand(program: Command): void {
  program
    .command('log')
    .description('Show recent activity events')
    .option('-n, --limit <number>', 'Number of events to show', '25')
    .option('-f, --follow', 'Follow daemon event stream')
    .action(async (opts: { limit: string; follow?: boolean }) => {
      const rootOptions = program.opts<{ json?: boolean; config?: string }>();
      const json = rootOptions.json;
      try {
        const limit = Number.parseInt(opts.limit, 10);
        if (Number.isNaN(limit) || limit < 1) {
          throw new Error('--limit must be a positive integer');
        }

        const eventsDesc = readRecentEvents(limit);
        const events = [...eventsDesc].reverse();
        const lastSeq = events.at(-1)?.eventId ?? 0;

        if (json) {
          if (opts.follow) {
            for (const event of events) {
              console.log(JSON.stringify(event));
            }
          } else {
            console.log(JSON.stringify(eventsDesc, null, 2));
            return;
          }
        } else if (events.length === 0) {
          console.log(chalk.dim('No events recorded yet.'));
        } else {
          for (const ev of events) {
            printEvent(ev);
          }
        }

        if (opts.follow) {
          const config = loadConfig(rootOptions.config);

          if (!json) {
            console.log(
              chalk.dim('--- following live events (Ctrl+C to stop) ---'),
            );
          }

          await followEvents(config.daemon.socketPath, lastSeq, Boolean(json));
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
