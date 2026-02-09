/**
 * The Janitor — OpenCode plugin entry point.
 *
 * Thin wiring layer that bootstraps the review runtime and connects
 * hook modules. All logic lives in:
 *   - src/runtime/review-runtime.ts  (bootstrap + lifecycle)
 *   - src/runtime/context.ts         (shared runtime context type)
 *   - src/agents/registry.ts         (config hook — agent registration)
 *   - src/hooks/command-hook.ts      (/janitor command handler)
 *   - src/hooks/tool-hook.ts         (bash detection acceleration)
 *   - src/hooks/event-hook.ts        (session completion/error/event logging)
 */

import type { Hooks, Plugin } from '@opencode-ai/plugin';
import { registerAgents } from './agents/registry';
import { loadConfig } from './config/loader';
import { createCommandHook } from './hooks/command-hook';
import { createEventHook } from './hooks/event-hook';
import { createToolHook } from './hooks/tool-hook';
import { createAgent } from './review/agent-factory';
import { bootstrapRuntime } from './runtime/review-runtime';
import { log } from './utils/logger';

let stopActiveRuntime: (() => Promise<void>) | null = null;

/** Best-effort toast — swallows errors so it never breaks init. */
function toast(ctx: Parameters<Plugin>[0], message: string) {
  try {
    ctx.client.tui
      .showToast({ body: { message, variant: 'info' as const } })
      .catch(() => {});
  } catch {
    // TUI may not be available
  }
}

const TheJanitor: Plugin = async (ctx) => {
  if (stopActiveRuntime) {
    await stopActiveRuntime();
    stopActiveRuntime = null;
  }

  const result = await bootstrapRuntime(ctx);

  if (!result) {
    const config = loadConfig(ctx.directory);
    const reason = config.enabled
      ? 'no git repo found — inactive'
      : 'disabled by config';
    toast(ctx, `Janitor: ${reason}`);
    return { name: 'the-janitor' } satisfies Hooks & { name: string };
  }

  const { rc, stop } = result;
  stopActiveRuntime = stop;

  const config = rc.config;
  const agents = (['janitor', 'hunter', 'inspector', 'scribe'] as const).map(
    (name) => createAgent(name, config),
  );

  toast(ctx, 'Janitor: watchers active');

  return {
    name: 'the-janitor',
    config: registerAgents(agents),
    'command.execute.before': createCommandHook(rc),
    'tool.execute.after': createToolHook(rc),
    event: createEventHook(rc),
  } satisfies Hooks & { name: string };
};

export default TheJanitor;
