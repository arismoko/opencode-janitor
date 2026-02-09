import type { PluginInput } from '@opencode-ai/plugin';
import type { EnrichmentData } from '../../history/enrichment';
import { enrichToastMessage } from '../../history/enrichment';
import { warn } from '../../utils/logger';

// ---------------------------------------------------------------------------
// Shared finding shape for toast rendering
// ---------------------------------------------------------------------------

interface ToastableFinding {
  domain: string;
}

interface ToastableResult {
  findings: ToastableFinding[];
  clean: boolean;
}

// ---------------------------------------------------------------------------
// Toast sink options
// ---------------------------------------------------------------------------

export interface ToastOptions {
  /** Display label prefix (e.g. "Janitor", "Code Review") */
  label: string;
  /** Short identifier (sha, pr id, etc.) */
  shortId: string;
  /** Optional enrichment data for janitor history annotations */
  enrichment?: EnrichmentData;
}

/**
 * Deliver a summary toast notification.
 *
 * Unified sink replacing both `deliverToast` and `deliverReviewerToast`.
 */
export async function deliverToast(
  ctx: PluginInput,
  result: ToastableResult,
  opts: ToastOptions,
): Promise<void> {
  let message: string;
  if (result.clean) {
    message = `${opts.label}: No issues in ${opts.shortId} ✓`;
  } else {
    const count = result.findings.length;
    const domains = [...new Set(result.findings.map((f) => f.domain))].join(
      ', ',
    );
    message = `${opts.label}: ${count} finding${count === 1 ? '' : 's'} in ${opts.shortId} (${domains})`;
  }

  if (opts.enrichment) {
    message = enrichToastMessage(message, opts.enrichment);
  }

  try {
    await (ctx.client as any).tui?.showToast?.({
      body: { message, variant: result.clean ? 'success' : 'warning' },
    });
  } catch {
    warn('[toast-sink] failed to show toast');
  }
}
