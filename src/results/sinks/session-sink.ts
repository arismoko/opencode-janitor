import type { PluginInput } from '@opencode-ai/plugin';
import type { EnrichmentData } from '../../history/enrichment';
import { buildHistorySection } from '../../history/enrichment';
import { warn } from '../../utils/logger';
import { injectMessage } from '../../utils/notifier';

/**
 * Deliver a full markdown report into the current session.
 *
 * When `noReply` is false (default), the parent session's agent can
 * act on the findings. Set `noReply: true` in config to suppress.
 */
export async function deliverToSession(
  ctx: PluginInput,
  sessionId: string,
  report: string,
  opts?: { enrichment?: EnrichmentData; noReply?: boolean },
): Promise<void> {
  if (!sessionId) {
    warn('[session-sink] no session ID provided');
    return;
  }

  const historySection = opts?.enrichment
    ? buildHistorySection(opts.enrichment)
    : '';

  await injectMessage(
    ctx,
    sessionId,
    `📋 **[Janitor Review Complete]**\n\n${report}${historySection}`,
    opts?.noReply ?? false,
  );
}
