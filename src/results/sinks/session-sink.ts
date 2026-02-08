import type { PluginInput } from '@opencode-ai/plugin';
import { warn } from '../../utils/logger';

/**
 * Deliver a full markdown report into the current session.
 * This injects the report as a message visible in the conversation.
 */
export async function deliverToSession(
  ctx: PluginInput,
  report: string,
): Promise<void> {
  try {
    // Get the current session list and find the root (non-parent) session
    const sessions = await ctx.client.session.list();
    const sessionList = sessions.data ?? [];

    // Find the most recent root session (no parentID)
    const rootSession = (sessionList as Array<{
      id: string;
      parentID?: string;
      createdAt?: string;
    }>)
      .filter((s) => !s.parentID)
      .sort((a, b) =>
        (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
      )[0];

    if (!rootSession?.id) {
      warn('[session-sink] no root session found');
      return;
    }

    await ctx.client.session.prompt({
      path: { id: rootSession.id },
      body: {
        parts: [
          {
            type: 'text' as const,
            text: `[Janitor Review Complete]\n\n${report}`,
          },
        ],
      },
    });
  } catch {
    warn('[session-sink] failed to deliver to session');
  }
}
