import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader';
import { requestJson } from '../ipc/client';
import type {
  ErrorResponse,
  HealthResponse,
  StopResponse,
} from '../ipc/protocol';

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

export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop the review daemon')
    .action(async () => {
      const rootOptions = program.opts<{ json?: boolean; config?: string }>();
      const json = rootOptions.json ?? false;
      try {
        const config = loadConfig(rootOptions.config);

        if (!(await isRunning(config.daemon.socketPath))) {
          if (json) {
            console.log(JSON.stringify({ ok: true, running: false }));
          } else {
            console.log(chalk.yellow('Daemon is not running.'));
          }
          return;
        }

        try {
          const stopResponse = await requestJson<StopResponse | ErrorResponse>({
            socketPath: config.daemon.socketPath,
            path: '/v1/daemon/stop',
            method: 'POST',
            timeoutMs: 3000,
          });

          if (stopResponse.status !== 200) {
            throw new Error('Failed to request daemon stop.');
          }
        } catch {
          // Connection can close quickly as daemon begins shutdown.
        }

        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          if (!(await isRunning(config.daemon.socketPath))) {
            if (json) {
              console.log(JSON.stringify({ ok: true, stopped: true }));
            } else {
              console.log(chalk.green('✓ Daemon stopped'));
            }
            return;
          }

          await Bun.sleep(125);
        }

        throw new Error('Timed out waiting for daemon to stop.');
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
