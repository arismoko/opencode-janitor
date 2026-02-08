import type { PluginInput } from '@opencode-ai/plugin';
import type { EnrichmentData } from '../../history/enrichment';
import { enrichToastMessage } from '../../history/enrichment';
import type { ReviewResult } from '../../types';
import { warn } from '../../utils/logger';

/**
 * Deliver a summary toast notification.
 */
export async function deliverToast(
  ctx: PluginInput,
  result: ReviewResult,
  enrichment?: EnrichmentData,
): Promise<void> {
  const shortSha = result.sha.slice(0, 7);

  let message: string;
  if (result.clean) {
    message = `Janitor: No P0 issues in ${shortSha} ✓`;
  } else {
    const count = result.findings.length;
    const categories = [
      ...new Set(result.findings.map((f) => f.category)),
    ].join(', ');
    message = `Janitor: ${count} P0 finding${count === 1 ? '' : 's'} in ${shortSha} (${categories})`;
  }

  if (enrichment) {
    message = enrichToastMessage(message, enrichment);
  }

  try {
    await (ctx.client as any).tui?.showToast?.({ message });
  } catch {
    warn('[toast-sink] failed to show toast');
  }
}
