/**
 * `janitor config` — manage CLI config file.
 */
import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import type { Command } from 'commander';
import { ensureConfigFile } from '../config/writer';

export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('Ensure config file exists and show its path')
    .option('-p, --print', 'Print config file contents')
    .action((opts: { print?: boolean }) => {
      const json = program.opts()['json'] as boolean | undefined;
      try {
        const path = ensureConfigFile();

        if (opts.print) {
          const content = readFileSync(path, 'utf-8');
          if (json) {
            console.log(JSON.stringify({ path, content }));
          } else {
            console.log(chalk.dim(`# ${path}`));
            console.log(content);
          }
          return;
        }

        if (json) {
          console.log(JSON.stringify({ path }));
        } else {
          console.log(`${chalk.green('✓')} Config: ${chalk.bold(path)}`);
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
