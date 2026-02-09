import type { PluginInput } from '@opencode-ai/plugin';
import type { EnrichmentData } from '../../history/enrichment';
import { buildHistorySection } from '../../history/enrichment';
import { warn } from '../../utils/logger';
import { injectMessage } from '../../utils/notifier';

/**
 * Deliver a full markdown report into a session.
 *
 * Unified sink replacing both `deliverToSession` and `deliverReviewerToSession`.
 * When `noReply` is false (default), the parent session's agent can act on findings.
 */
export async function deliverToSession(
  ctx: PluginInput,
  sessionId: string,
  report: string,
  opts?: {
    label?: string;
    enrichment?: EnrichmentData;
    noReply?: boolean;
  },
): Promise<void> {
  if (!sessionId) {
    warn('[session-sink] no session ID provided');
    return;
  }

  const label = opts?.label ?? 'Review Complete';
  const historySection = opts?.enrichment
    ? buildHistorySection(opts.enrichment)
    : '';

  await injectMessage(
    ctx,
    sessionId,
    `📋 **[${label}]**\n\n${report}${historySection}`,
    opts?.noReply ?? false,
  );
}
