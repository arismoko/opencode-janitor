import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader';
import { requestJson } from '../ipc/client';
import { isRunning } from '../ipc/health';
import type { DaemonStatusResponse, ErrorResponse } from '../ipc/protocol';
import { toWebUrl } from '../utils/web-url';

function formatMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return `${minutes}m ${rem}s`;
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show daemon status')
    .action(async () => {
      const rootOptions = program.opts<{ json?: boolean; config?: string }>();
      const json = rootOptions.json ?? false;
      const config = loadConfig(rootOptions.config);

      try {
        if (!(await isRunning(config.daemon.socketPath, 1000))) {
          throw new Error('Daemon is not running.');
        }

        const status = await requestJson<DaemonStatusResponse | ErrorResponse>({
          socketPath: config.daemon.socketPath,
          path: '/v1/daemon/status',
          method: 'GET',
          timeoutMs: 1000,
        });

        if (status.status !== 200) {
          throw new Error('Failed to fetch daemon status.');
        }

        const payload = status.data as DaemonStatusResponse;

        if (json) {
          console.log(JSON.stringify(payload, null, 2));
          return;
        }

        console.log(chalk.green('Daemon running'));
        console.log(`pid: ${payload.pid}`);
        console.log(`uptime: ${formatMs(payload.uptimeMs)}`);
        console.log(`draining: ${payload.draining ? 'yes' : 'no'}`);
        console.log(`socket: ${payload.socketPath}`);
        console.log(`db: ${payload.dbPath}`);
        console.log(`web: ${toWebUrl(payload.webHost, payload.webPort)}`);
      } catch {
        if (json) {
          console.log(JSON.stringify({ ok: false, running: false }));
        } else {
          console.log(chalk.yellow('Daemon is not running.'));
        }
      }
    });
}
