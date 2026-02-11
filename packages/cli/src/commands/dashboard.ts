import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader';
import { requestJson } from '../ipc/client';
import type {
  DaemonStatusResponse,
  ErrorResponse,
  HealthResponse,
} from '../ipc/protocol';
import { toWebUrl } from '../utils/web-url';

interface DashboardOptions {
  printUrl?: boolean;
}

function openUrlInBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];

  const proc = Bun.spawnSync({
    cmd,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  });

  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString('utf8').trim();
    throw new Error(
      stderr ||
        `Failed to open browser (command: ${cmd.join(' ')}, exit: ${proc.exitCode})`,
    );
  }
}

export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .description('Open the web dashboard in your browser')
    .option('--print-url', 'Print dashboard URL without opening browser')
    .action(async (options: DashboardOptions) => {
      const rootOptions = program.opts<{ json?: boolean; config?: string }>();
      const json = rootOptions.json ?? false;

      try {
        const config = loadConfig(rootOptions.config);

        const health = await requestJson<HealthResponse | ErrorResponse>({
          socketPath: config.daemon.socketPath,
          path: '/v1/health',
          method: 'GET',
          timeoutMs: 1000,
        });
        if (health.status !== 200) {
          throw new Error(
            'Daemon is not running. Start it with `opencode-janitor start`.',
          );
        }

        const status = await requestJson<DaemonStatusResponse | ErrorResponse>({
          socketPath: config.daemon.socketPath,
          path: '/v1/daemon/status',
          method: 'GET',
          timeoutMs: 1500,
        });
        if (status.status !== 200) {
          const err = status.data as ErrorResponse;
          throw new Error(
            err.error?.message ?? 'Failed to fetch daemon dashboard URL.',
          );
        }

        const payload = status.data as DaemonStatusResponse;
        const url = toWebUrl(payload.webHost, payload.webPort);

        if (options.printUrl) {
          if (json) {
            console.log(JSON.stringify({ ok: true, url, opened: false }));
          } else {
            console.log(url);
          }
          return;
        }

        openUrlInBrowser(url);

        if (json) {
          console.log(JSON.stringify({ ok: true, url, opened: true }));
          return;
        }

        console.log(`${chalk.cyan('↗')} Opened dashboard: ${chalk.dim(url)}`);
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
