import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader';
import { runDaemonMain } from '../daemon/main';
import { requestJson } from '../ipc/client';
import type { ErrorResponse, HealthResponse } from '../ipc/protocol';

interface StartOptions {
  foreground?: boolean;
}

async function isRunning(socketPath: string): Promise<boolean> {
  try {
    const response = await requestJson<HealthResponse | ErrorResponse>({
      socketPath,
      path: '/v1/health',
      method: 'GET',
      timeoutMs: 750,
    });

    return response.status === 200;
  } catch {
    return false;
  }
}

async function waitUntilUp(
  socketPath: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isRunning(socketPath)) {
      return;
    }
    await Bun.sleep(125);
  }

  throw new Error('Daemon did not become healthy in time.');
}

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start the review daemon')
    .option('--foreground', 'Run in foreground process')
    .action(async (options: StartOptions) => {
      const rootOptions = program.opts<{ json?: boolean; config?: string }>();
      const json = rootOptions.json ?? false;

      try {
        const configPath = rootOptions.config;
        const config = loadConfig(configPath);

        if (await isRunning(config.daemon.socketPath)) {
          if (json) {
            console.log(JSON.stringify({ ok: true, running: true }));
          } else {
            console.log(chalk.yellow('Daemon already running.'));
          }
          return;
        }

        if (options.foreground) {
          if (!json) {
            console.log(chalk.green('Starting daemon in foreground...'));
          }
          await runDaemonMain(configPath);
          return;
        }

        const scriptPath = process.argv[1];
        if (!scriptPath) {
          throw new Error(
            'Unable to resolve CLI script path for daemon spawn.',
          );
        }

        const args = [scriptPath, 'daemon'];
        if (configPath) {
          args.push('--config', configPath);
        }

        const proc = Bun.spawn({
          cmd: [process.execPath, ...args],
          stdin: 'ignore',
          stdout: 'ignore',
          stderr: 'ignore',
        });

        proc.unref();

        await waitUntilUp(config.daemon.socketPath, 5000);

        if (json) {
          console.log(
            JSON.stringify({
              ok: true,
              running: true,
              pid: proc.pid,
              socketPath: config.daemon.socketPath,
            }),
          );
        } else {
          console.log(
            `${chalk.green('✓')} Daemon started (pid=${proc.pid}) ${chalk.dim(config.daemon.socketPath)}`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (json) {
          console.error(JSON.stringify({ error: message }));
        } else {
          console.error(`${chalk.red('✗')} ${message}`);
        }
        process.exit(1);
      }
    });
}
