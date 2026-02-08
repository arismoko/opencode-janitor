import type { PluginInput } from '@opencode-ai/plugin';
import { warn } from '../../utils/logger';
import { injectMessage } from '../../utils/notifier';

/**
 * Deliver a reviewer markdown report into the current session.
 *
 * When `noReply` is false (default), the parent session's agent can
 * act on the findings. Set `noReply: true` in config to suppress.
 */
export async function deliverReviewerToSession(
  ctx: PluginInput,
  sessionId: string,
  report: string,
  noReply = false,
): Promise<void> {
  if (!sessionId) {
    warn('[reviewer-session-sink] no session ID provided');
    return;
  }

  await injectMessage(
    ctx,
    sessionId,
    `📋 **[Code Review Complete]**\n\n${report}`,
    noReply,
  );
}
