/**
 * Agent subcommands — one per agent, each with a one-letter alias.
 *
 *   opencode-janitor janitor [repo]           # alias: j
 *   opencode-janitor hunter [repo] --pr <n>   # alias: h
 *   opencode-janitor inspector [repo]         # alias: i
 *   opencode-janitor scribe [repo]            # alias: s
 */

import type { AgentName } from '@opencode-janitor/shared';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader';
import { requestJson } from '../ipc/client';
import type { EnqueueReviewResponse, ErrorResponse } from '../ipc/protocol';
import { validateGitRepo } from '../utils/git';

function resolveRepo(raw?: string): string {
  if (!raw || raw.trim().length === 0) {
    try {
      return validateGitRepo(process.cwd());
    } catch {
      throw new Error(
        'No repo specified and current directory is not a git repository.',
      );
    }
  }

  const candidate = raw.trim();
  try {
    return validateGitRepo(candidate);
  } catch {
    return candidate;
  }
}

async function runAgent(
  program: Command,
  agent: AgentName,
  repoArg: string | undefined,
  pr?: number,
): Promise<void> {
  const rootOptions = program.opts<{ json?: boolean; config?: string }>();
  const json = rootOptions.json;

  try {
    const repoOrId = resolveRepo(repoArg);
    const config = loadConfig(rootOptions.config);

    const body: Record<string, unknown> = { repoOrId, agent };
    if (pr !== undefined) {
      body.pr = pr;
    }

    const response = await requestJson<EnqueueReviewResponse | ErrorResponse>({
      socketPath: config.daemon.socketPath,
      path: '/v1/reviews/enqueue',
      method: 'POST',
      body,
      timeoutMs: 4000,
    });

    if (response.status !== 200) {
      const err = response.data as ErrorResponse;
      const message = err.error?.message ?? 'Failed to enqueue review';
      throw new Error(message);
    }

    const payload = response.data as EnqueueReviewResponse;
    const { enqueued, repoPath, sha, subjectKey } = payload;

    if (json) {
      console.log(
        JSON.stringify({
          enqueued,
          repoId: payload.repoId,
          repoPath,
          sha,
          subjectKey,
          agent,
          pr,
        }),
      );
      return;
    }

    const prLabel = pr ? ` PR #${pr}` : '';
    const label = `${chalk.bold(agent)}${prLabel}`;

    if (enqueued) {
      console.log(
        `${chalk.green('✓')} ${label} review enqueued for ${chalk.bold(repoPath)} at ${chalk.dim(sha.slice(0, 10))}`,
      );
    } else {
      console.log(
        `${chalk.yellow('⚠')} ${label} review already queued for ${chalk.bold(repoPath)} at ${chalk.dim(sha.slice(0, 10))}`,
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
}

export function registerAgentCommands(program: Command): void {
  // janitor (j) — structural cleanup
  program
    .command('janitor [repo]')
    .alias('j')
    .description('Run the Janitor agent (structural cleanup: YAGNI, DRY, DEAD)')
    .action(async (repoArg?: string) => {
      await runAgent(program, 'janitor', repoArg);
    });

  // hunter (h) — bug/correctness review, with optional --pr
  program
    .command('hunter [repo]')
    .alias('h')
    .description('Run the Hunter agent (bug/correctness defects)')
    .option('--pr <number>', 'PR number to review (builds PR-aware context)')
    .action(async (repoArg: string | undefined, options: { pr?: string }) => {
      let pr: number | undefined;
      if (options.pr !== undefined) {
        pr = Number.parseInt(options.pr, 10);
        if (!Number.isFinite(pr) || pr <= 0) {
          console.error(`${chalk.red('✗')} --pr must be a positive integer`);
          process.exit(1);
        }
      }
      await runAgent(program, 'hunter', repoArg, pr);
    });

  // inspector (i) — deep inspection
  program
    .command('inspector [repo]')
    .alias('i')
    .description('Run the Inspector agent (deep code inspection)')
    .action(async (repoArg?: string) => {
      await runAgent(program, 'inspector', repoArg);
    });

  // scribe (s) — documentation review
  program
    .command('scribe [repo]')
    .alias('s')
    .description('Run the Scribe agent (documentation quality review)')
    .action(async (repoArg?: string) => {
      await runAgent(program, 'scribe', repoArg);
    });
}
