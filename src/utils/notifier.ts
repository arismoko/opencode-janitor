import type { PluginInput } from '@opencode-ai/plugin';
import { warn } from './logger';

/**
 * Injects a message into a session without triggering an LLM response.
 *
 * Uses the synchronous `prompt()` API with `noReply: true` so the server
 * persists the message and returns a regular JSON response (no SSE streaming).
 * This gives us confirmation that the message was written to the session
 * history, unlike `promptAsync` which is fire-and-forget (204 No Content).
 */
export async function injectMessage(
  ctx: PluginInput,
  sessionId: string,
  text: string,
): Promise<void> {
  try {
    await ctx.client.session.prompt({
      path: { id: sessionId },
      body: {
        noReply: true,
        parts: [{ type: 'text' as const, text }],
      },
    });
  } catch {
    warn(`[notifier] failed to inject message into session ${sessionId}`);
  }
}

/**
 * Notify the user of a janitor error in the parent session.
 * Formats the error with a recognizable prefix so it's easy to spot.
 */
export async function notifyError(
  ctx: PluginInput,
  sessionId: string,
  context: string,
  err: unknown,
): Promise<void> {
  const errMsg = err instanceof Error ? err.message : String(err);
  const text = `⚠️ **[Janitor Error]** ${context}\n\n\`\`\`\n${errMsg}\n\`\`\``;
  await injectMessage(ctx, sessionId, text);
}

/**
 * Notify the user of a janitor status update in the parent session.
 */
export async function notifyStatus(
  ctx: PluginInput,
  sessionId: string,
  message: string,
): Promise<void> {
  await injectMessage(ctx, sessionId, `🔍 **[Janitor]** ${message}`);
}
