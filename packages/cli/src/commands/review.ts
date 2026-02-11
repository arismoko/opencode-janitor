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
import { registerAgentCommandsFromRegistry } from './agent-command-factory';

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
  scope?: string,
  input?: Record<string, unknown>,
): Promise<void> {
  const rootOptions = program.opts<{ json?: boolean; config?: string }>();
  const json = rootOptions.json;

  try {
    const repoOrId = resolveRepo(repoArg);
    const config = loadConfig(rootOptions.config);

    const body: Record<string, unknown> = { repoOrId, agent };
    if (scope) {
      body.scope = scope;
    }
    if (input) {
      body.input = input;
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
    const { enqueued, repoPath, sha, subject } = payload;
    const prNumber =
      scope === 'pr' && typeof input?.prNumber === 'number'
        ? input.prNumber
        : undefined;

    if (json) {
      console.log(
        JSON.stringify({
          enqueued,
          repoId: payload.repoId,
          repoPath,
          sha,
          subject,
          agent,
          ...(scope ? { scope } : {}),
          ...(input ? { input } : {}),
        }),
      );
      return;
    }

    const prLabel = prNumber ? ` PR #${prNumber}` : '';
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
  registerAgentCommandsFromRegistry(program, async (invocation) => {
    await runAgent(
      program,
      invocation.agent,
      invocation.repoArg,
      invocation.scope,
      invocation.input,
    );
  });
}
