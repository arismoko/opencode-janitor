import type { PluginInput } from '@opencode-ai/plugin';
import { warn } from '../../utils/logger';
import { injectMessage } from '../../utils/notifier';

/**
 * Deliver a reviewer markdown report into the current session.
 * Uses noReply: true so the report appears in the conversation
 * without triggering an LLM response.
 */
export async function deliverReviewerToSession(
  ctx: PluginInput,
  sessionId: string,
  report: string,
): Promise<void> {
  if (!sessionId) {
    warn('[reviewer-session-sink] no session ID provided');
    return;
  }

  await injectMessage(
    ctx,
    sessionId,
    `📋 **[Code Review Complete]**\n\n${report}`,
  );
}
