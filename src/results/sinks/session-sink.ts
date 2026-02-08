import type { PluginInput } from '@opencode-ai/plugin';
import type { EnrichmentData } from '../../history/enrichment';
import { buildHistorySection } from '../../history/enrichment';
import { warn } from '../../utils/logger';
import { injectMessage } from '../../utils/notifier';

/**
 * Deliver a full markdown report into the current session.
 * Uses noReply: true so the report appears in the conversation
 * without triggering an LLM response.
 */
export async function deliverToSession(
  ctx: PluginInput,
  sessionId: string,
  report: string,
  enrichment?: EnrichmentData,
): Promise<void> {
  if (!sessionId) {
    warn('[session-sink] no session ID provided');
    return;
  }

  const historySection = enrichment ? buildHistorySection(enrichment) : '';

  await injectMessage(
    ctx,
    sessionId,
    `📋 **[Janitor Review Complete]**\n\n${report}${historySection}`,
  );
}
