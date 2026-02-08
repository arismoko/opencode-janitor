import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import { log, error } from '../utils/logger';

/** Tools available to the janitor agent */
const JANITOR_TOOLS: Record<string, boolean> = {
  glob: true,
  grep: true,
  Read: true,
  ast_grep_search: true,
};

/**
 * Spawn an isolated background session for a janitor review.
 * Returns the session ID for tracking completion.
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

  // Build prompt body
  const body: Record<string, unknown> = {
    agent: 'janitor',
    tools: JANITOR_TOOLS,
    parts: [{ type: 'text', text: opts.prompt }],
  };

  // Override model if configured
  if (opts.config.model.id) {
    const slashIdx = opts.config.model.id.indexOf('/');
    if (slashIdx > 0) {
      body.model = {
        providerID: opts.config.model.id.slice(0, slashIdx),
        modelID: opts.config.model.id.slice(slashIdx + 1),
      };
    }
  }

  // Send prompt
  try {
    await ctx.client.session.prompt({
      path: { id: sessionId },
      body,
      query: { directory: ctx.directory },
    });
    log(`[runner] prompt sent to session: ${sessionId}`);
  } catch (err) {
    error(`[runner] failed to send prompt to session ${sessionId}`, err);
    throw err;
  }

  return sessionId;
}
