import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import { error, log } from '../utils/logger';
import type { AgentDefinition } from './janitor-agent';

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
 *
 * The janitor agent is NOT registered in OpenCode's agent registry
 * (plugins can't do that). Instead we pass the system prompt via the
 * `system` field and let the session use the default/configured agent
 * with our custom instructions injected.
 */
export async function spawnJanitorReview(
  ctx: PluginInput,
  opts: {
    parentSessionId: string;
    prompt: string;
    config: JanitorConfig;
    agent: AgentDefinition;
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

  // Build prompt body — use `system` to inject the janitor persona
  // instead of `agent: 'janitor'` which would require registry support.
  const body: {
    parts: Array<{ type: 'text'; text: string }>;
    system?: string;
    tools?: Record<string, boolean>;
    model?: { providerID: string; modelID: string };
  } = {
    system: opts.agent.config.prompt,
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

  // Send prompt asynchronously — promptAsync returns 204 (fire-and-forget)
  // and lets the review session run in the background. The synchronous
  // prompt() expects to parse a full JSON response body which fails
  // because the server streams the LLM response via SSE.
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
