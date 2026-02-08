import type { PluginInput } from '@opencode-ai/plugin';
import { getErrorMessage, warn } from './logger';

/**
 * Injects a message into a session.
 *
 * When `noReply` is true (default for error notifications), uses `noReply: true`
 * so the message appears without triggering an LLM response.
 * When `noReply` is false (default for review output), the parent session
 * receives the message and can reply — letting the user's agent act on findings.
 *
 * Uses the synchronous `prompt()` API so we get confirmation the message
 * was written to session history, unlike `promptAsync` (fire-and-forget 204).
 */
export async function injectMessage(
  ctx: PluginInput,
  sessionId: string,
  text: string,
  noReply = true,
): Promise<void> {
  try {
    await ctx.client.session.prompt({
      path: { id: sessionId },
      body: {
        noReply,
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
  const errMsg = getErrorMessage(err);
  const text = `⚠️ **[Janitor Error]** ${context}\n\n\`\`\`\n${errMsg}\n\`\`\``;
  await injectMessage(ctx, sessionId, text);
}
