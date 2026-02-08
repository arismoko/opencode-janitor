import type { PluginInput } from '@opencode-ai/plugin';
import { warn } from './logger';

/**
 * Injects a message into a session without triggering an LLM response.
 * Uses the `noReply: true` flag on the prompt API so the message appears
 * in the conversation history but doesn't interrupt the current flow.
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
