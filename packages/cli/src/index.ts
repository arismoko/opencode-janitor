#!/usr/bin/env bun

/**
 * @opencode-janitor/cli
 *
 * Commander-based CLI for managing tracked repos and querying activity.
 */

import { Command } from 'commander';
import { registerAddCommand } from './commands/add';
import { registerConfigCommand } from './commands/config';
import { registerDashboardCommand } from './commands/dashboard';
import { registerLogCommand } from './commands/log';
import { registerRemoveCommand } from './commands/remove';
import { registerReviewCommand } from './commands/review';
import { registerStartCommand } from './commands/start';
import { registerStatusCommand } from './commands/status';
import { registerStopCommand } from './commands/stop';
import { runDaemonMain } from './daemon/main';

const program = new Command();

program
  .name('opencode-janitor')
  .description('CLI for opencode-janitor — automated code review management')
  .version('0.1.0')
  .option('--json', 'Output in JSON format')
  .option('--config <path>', 'Path to config JSON file');

// Phase 2 commands
registerAddCommand(program);
registerRemoveCommand(program);
registerLogCommand(program);
registerConfigCommand(program);
registerDashboardCommand(program);
registerStartCommand(program);
registerStopCommand(program);
registerStatusCommand(program);
registerReviewCommand(program);

program
  .command('daemon', { hidden: true })
  .description('Internal daemon entrypoint')
  .action(async () => {
    const rootOptions = program.opts<{ config?: string }>();
    await runDaemonMain(rootOptions.config);
  });

program.parse();
