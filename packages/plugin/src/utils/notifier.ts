import type { PluginInput } from '@opencode-ai/plugin';
import { getErrorMessage, warn } from './logger';

/**
 * Injects a message into a session.
 *
 * Always uses `promptAsync` to avoid blocking plugin hooks or the UI —
 * even `noReply: true` inserts can stall on network/server with sync `prompt()`.
 * The `noReply` flag controls only whether the assistant generates a reply,
 * not the transport mode.
 */
export async function injectMessage(
  ctx: PluginInput,
  sessionId: string,
  text: string,
  noReply = true,
): Promise<void> {
  try {
    await ctx.client.session.promptAsync({
      path: { id: sessionId },
      body: {
        noReply,
        parts: [{ type: 'text' as const, text }],
      },
      query: { directory: ctx.directory },
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
  const errMsg = getErrorMessage(err);
  const text = `⚠️ **[Janitor Error]** ${context}\n\n\`\`\`\n${errMsg}\n\`\`\``;
  await injectMessage(ctx, sessionId, text);
}
