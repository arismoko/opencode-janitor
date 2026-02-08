import type { PluginInput } from '@opencode-ai/plugin';
import { warn } from '../../utils/logger';
import type { ReviewerResult } from '../reviewer-parser';

/**
 * Deliver a summary toast notification for a reviewer result.
 */
export async function deliverReviewerToast(
  ctx: PluginInput,
  result: ReviewerResult,
): Promise<void> {
  const shortId = result.id.slice(0, 12);

  let message: string;
  if (result.clean) {
    message = `Code Review: No issues found in ${shortId}`;
  } else {
    const count = result.findings.length;
    const domains = [...new Set(result.findings.map((f) => f.domain))].join(
      ', ',
    );
    message = `Code Review: ${count} finding${count === 1 ? '' : 's'} in ${shortId} (${domains})`;
  }

  try {
    await (ctx.client as any).tui?.showToast?.({
      body: { message, variant: result.clean ? 'success' : 'warning' },
    });
  } catch {
    warn('[reviewer-toast-sink] failed to show toast');
  }
}
