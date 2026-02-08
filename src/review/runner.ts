import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import { error, log } from '../utils/logger';

/**
 * Spawn an isolated background session for a janitor review.
 * Returns the session ID for tracking completion.
 *
 * The janitor agent is registered in OpenCode's agent registry via the
 * plugin's `config` hook (see index.ts). We reference it by name here
 * so the session uses the janitor's model, temperature, prompt, and tool
 * permissions instead of the default orchestrator agent.
 */
export async function spawnJanitorReview(
  ctx: PluginInput,
  opts: {
    parentSessionId: string;
    prompt: string;
    config: JanitorConfig;
  },
): Promise<string> {
  log('[runner] spawning review session');

  // Create isolated session
  const session = await ctx.client.session.create({
    body: {
      parentID: opts.parentSessionId,
      title: 'Janitor Review',
    },
    query: { directory: ctx.directory },
  });

  if (!session.data?.id) {
    throw new Error('Failed to create Janitor review session');
  }

  const sessionId = session.data.id;
  log(`[runner] session created: ${sessionId}`);

  // Build prompt body — reference the 'janitor' agent registered via
  // the config hook. OpenCode resolves it from the agent registry and
  // applies its model, temperature, system prompt, and tool permissions.
  const body: {
    parts: Array<{ type: 'text'; text: string }>;
    agent?: string;
    model?: { providerID: string; modelID: string };
  } = {
    agent: 'janitor',
    parts: [{ type: 'text', text: opts.prompt }],
  };

  // Override model if explicitly configured (takes precedence over
  // the model set in the agent's config)
  if (opts.config.model.id) {
    const slashIdx = opts.config.model.id.indexOf('/');
    if (slashIdx > 0) {
      body.model = {
        providerID: opts.config.model.id.slice(0, slashIdx),
        modelID: opts.config.model.id.slice(slashIdx + 1),
      };
    }
  }

  // Send prompt asynchronously — promptAsync returns 204 (fire-and-forget)
  // and lets the review session run in the background. The synchronous
  // prompt() would block until the LLM finishes streaming.
  try {
    await ctx.client.session.promptAsync({
      path: { id: sessionId },
      body: body as any,
      query: { directory: ctx.directory },
    });
    log(`[runner] prompt sent to session: ${sessionId}`);
  } catch (err) {
    error(`[runner] failed to send prompt to session ${sessionId}`, err);
    throw err;
  }

  return sessionId;
}
