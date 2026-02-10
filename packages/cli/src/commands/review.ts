/**
 * `janitor review <repoOrId>` — trigger a manual review for a repository.
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader';
import { requestJson } from '../ipc/client';
import type { EnqueueReviewResponse, ErrorResponse } from '../ipc/protocol';
import { validateGitRepo } from '../utils/git';

const VALID_AGENTS = ['janitor', 'hunter', 'inspector', 'scribe'] as const;

interface ReviewCommandOptions {
  agent?: string;
}

function parseAgentOption(
  raw?: string,
): (typeof VALID_AGENTS)[number] | undefined {
  if (!raw) return undefined;

  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;

  if (!VALID_AGENTS.includes(normalized as (typeof VALID_AGENTS)[number])) {
    throw new Error(
      `Invalid agent "${raw}". Expected one of: ${VALID_AGENTS.join(', ')}`,
    );
  }

  return normalized as (typeof VALID_AGENTS)[number];
}

function resolveRepoOrId(raw?: string): string {
  if (!raw || raw.trim().length === 0) {
    try {
      return validateGitRepo(process.cwd());
    } catch {
      throw new Error(
        'No repo specified and current directory is not a git repository. Pass <repoOrId> explicitly.',
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

export function registerReviewCommand(program: Command): void {
  program
    .command('review [repoOrId]')
    .description(
      'Trigger a manual review for a tracked repository (defaults to current repo)',
    )
    .option(
      '--agent <agent>',
      'Run only one agent (janitor|hunter|inspector|scribe)',
    )
    .action(
      async (repoArg: string | undefined, options: ReviewCommandOptions) => {
        const rootOptions = program.opts<{ json?: boolean; config?: string }>();
        const json = rootOptions.json;
        try {
          const agent = parseAgentOption(options.agent);
          const repoOrId = resolveRepoOrId(repoArg);
          const config = loadConfig(rootOptions.config);
          const response = await requestJson<
            EnqueueReviewResponse | ErrorResponse
          >({
            socketPath: config.daemon.socketPath,
            path: '/v1/reviews/enqueue',
            method: 'POST',
            body: agent ? { repoOrId, agent } : { repoOrId },
            timeoutMs: 4000,
          });

          if (response.status !== 200) {
            const err = response.data as ErrorResponse;
            const message = err.error?.message ?? 'Failed to enqueue review';
            throw new Error(message);
          }

          const payload = response.data as EnqueueReviewResponse;

          const { enqueued, repoId, repoPath, sha, subjectKey } = payload;

          if (json) {
            console.log(
              JSON.stringify({
                enqueued,
                repoId,
                repoPath,
                sha,
                subjectKey,
                agent,
              }),
            );
            return;
          }

          const label = agent ? ` (${chalk.bold(agent)})` : '';

          if (enqueued) {
            console.log(
              `${chalk.green('✓')} Review${label} enqueued for ${chalk.bold(repoPath)} at ${chalk.dim(sha.slice(0, 10))}`,
            );
          } else {
            console.log(
              `${chalk.yellow('⚠')} Review${label} already queued for ${chalk.bold(repoPath)} at ${chalk.dim(sha.slice(0, 10))}`,
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
      },
    );
}
