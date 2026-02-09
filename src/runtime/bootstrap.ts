/**
 * Bootstrap infrastructure — config, git resolution, stores, state dir.
 */

import { join } from 'node:path';
import type { PluginInput } from '@opencode-ai/plugin';
import { loadConfig } from '../config/loader';
import type { JanitorConfig } from '../config/schema';
import { isGhAvailable } from '../git/gh-pr';
import { resolveGitDir } from '../git/repo-locator';
import { HistoryStore } from '../history/store';
import { RuntimeStateStore } from '../state/store';
import { SuppressionStore } from '../suppressions/store';
import { atomicWriteSync } from '../utils/atomic-write';
import { log, warn } from '../utils/logger';
import { ensureStateDir, resolveStateDir } from '../utils/state-dir';
import type { AgentControl, RuntimeFlag } from './context';
import { createExec, type Exec } from './context';

type TriggerMode = 'commit' | 'pr' | 'both' | 'never';

function triggerMatches(trigger: TriggerMode, mode: 'commit' | 'pr'): boolean {
  if (trigger === 'never') return false;
  return trigger === mode || trigger === 'both';
}

export interface BootstrapServices {
  ctx: PluginInput;
  config: JanitorConfig;
  exec: Exec;
  gitDir: string;
  stateDir: string;
  store: RuntimeStateStore;
  suppressionStore: SuppressionStore;
  historyStore: HistoryStore;
  trackedSessions: Set<string>;
  control: AgentControl;
  runtime: RuntimeFlag;
  ghAvailableAtStartup: boolean;
  previouslyProcessed: string[];
  previouslyProcessedPrKeys: string[];
  janitorCommitEnabled: boolean;
  janitorPrEnabled: boolean;
  hunterCommitEnabled: boolean;
  hunterPrEnabled: boolean;
  anyCommitReviews: boolean;
  anyPrReviews: boolean;
  writeSessionMeta: (
    sessionId: string,
    meta: {
      title: string;
      agent: string;
      key: string;
      status: string;
      startedAt: number;
      completedAt?: number;
    },
  ) => void;
}

/**
 * Bootstrap infrastructure services.
 * Returns null if the plugin should be inactive (no git repo or disabled).
 */
export async function bootstrapServices(
  ctx: PluginInput,
): Promise<BootstrapServices | null> {
  const config = loadConfig(ctx.directory);

  if (!config.enabled) {
    log('disabled by config');
    return null;
  }

  const exec = createExec(ctx);

  let gitDir: string;
  try {
    gitDir = await resolveGitDir(ctx.directory, exec);
  } catch {
    warn(`no git repo at ${ctx.directory} — janitor inactive`);
    return null;
  }

  const janitorCommitEnabled =
    config.agents.janitor.enabled &&
    triggerMatches(config.agents.janitor.trigger, 'commit');
  const janitorPrEnabled =
    config.agents.janitor.enabled &&
    triggerMatches(config.agents.janitor.trigger, 'pr');
  const hunterCommitEnabled =
    config.agents.hunter.enabled &&
    triggerMatches(config.agents.hunter.trigger, 'commit');
  const hunterPrEnabled =
    config.agents.hunter.enabled &&
    triggerMatches(config.agents.hunter.trigger, 'pr');

  const anyCommitReviews = janitorCommitEnabled || hunterCommitEnabled;
  const anyPrReviews = janitorPrEnabled || hunterPrEnabled;

  const ghAvailableAtStartup = anyPrReviews ? await isGhAvailable(exec) : false;
  if (anyPrReviews && !ghAvailableAtStartup) {
    warn(
      '[init] gh CLI not available — PR reviews will fall back to session/toast/file delivery',
    );
  }

  const store = new RuntimeStateStore(ctx.directory);
  const runtime = { disposed: false };

  const stateDir = resolveStateDir(ctx.directory);
  ensureStateDir(stateDir);
  const trackedSessions = new Set<string>();

  const writeSessionMeta = (
    sessionId: string,
    meta: {
      title: string;
      agent: string;
      key: string;
      status: string;
      startedAt: number;
      completedAt?: number;
    },
  ) => {
    atomicWriteSync(
      join(stateDir, `${sessionId}.json`),
      JSON.stringify(
        { id: sessionId, workspaceDir: ctx.directory, ...meta },
        null,
        2,
      ),
    );
  };

  const paused = store.getPaused();
  const control = {
    pausedJanitor: paused.janitor,
    pausedHunter: paused.hunter,
  };
  const suppressionStore = new SuppressionStore(ctx.directory, {
    maxEntries: config.suppressions?.maxEntries,
  });
  const historyStore = new HistoryStore(ctx.directory, {
    maxReviews: config.history?.maxReviews,
    maxBytes: config.history?.maxBytes,
  });

  const previouslyProcessed = store.getProcessed();
  const previouslyProcessedPrKeys = store.getProcessedPrKeys();

  return {
    ctx,
    config,
    exec,
    gitDir,
    stateDir,
    store,
    suppressionStore,
    historyStore,
    trackedSessions,
    control,
    runtime,
    ghAvailableAtStartup,
    previouslyProcessed,
    previouslyProcessedPrKeys,
    janitorCommitEnabled,
    janitorPrEnabled,
    hunterCommitEnabled,
    hunterPrEnabled,
    anyCommitReviews,
    anyPrReviews,
    writeSessionMeta,
  };
}
