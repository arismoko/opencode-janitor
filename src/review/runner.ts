import type { PluginInput } from '@opencode-ai/plugin';
import { error, log } from '../utils/logger';

export interface SpawnReviewOpts {
  /** The review prompt to send */
  prompt: string;
  /** Session title (e.g. "[janitor-run] commit:abc123") */
  title: string;
  /** Agent name registered in the config hook */
  agent: string;
  /** Optional model override (provider/model format) */
  modelId?: string;
  /** Parent session ID for lineage tracking */
  parentID?: string;
}

/**
 * Spawn an isolated background session for a review.
 *
 * Replaces `spawnJanitorReview` and `spawnHunterReview` with a single
 * agent-agnostic entry point. The agent is referenced by name so OpenCode
 * resolves its model, temperature, system prompt, and tool permissions.
 *
 * Returns the session ID for tracking completion.
 */
export async function spawnReview(
  ctx: PluginInput,
  opts: SpawnReviewOpts,
): Promise<string> {
  log(`[runner] spawning ${opts.agent} session`);

  // Create isolated session
  const session = await ctx.client.session.create({
    body: {
      title: opts.title,
      parentID: opts.parentID,
    },
    query: { directory: ctx.directory },
  });

  if (!session.data?.id) {
    throw new Error(`Failed to create ${opts.agent} review session`);
  }

  const sessionId = session.data.id;
  log(`[runner] session created: ${sessionId}`);

  // Build prompt body — reference the agent registered via the config hook.
  // OpenCode resolves it from the agent registry and applies its model,
  // temperature, system prompt, and tool permissions.
  const body: {
    parts: Array<{ type: 'text'; text: string }>;
    agent?: string;
    model?: { providerID: string; modelID: string };
  } = {
    agent: opts.agent,
    parts: [{ type: 'text', text: opts.prompt }],
  };

  // Override model if explicitly configured (takes precedence over
  // the model set in the agent's config)
  if (opts.modelId) {
    const slashIdx = opts.modelId.indexOf('/');
    if (slashIdx > 0) {
      body.model = {
        providerID: opts.modelId.slice(0, slashIdx),
        modelID: opts.modelId.slice(slashIdx + 1),
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
