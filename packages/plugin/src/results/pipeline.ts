/**
 * Post-processing pipeline for review output.
 *
 * Transforms raw LLM output into enriched results by:
 * 1. Parsing findings from raw text
 * 2. Filtering suppressed findings (deterministic safety net)
 * 3. Annotating lifecycle state (new/persistent/regressed)
 * 4. Computing trends and building enrichment data
 * 5. Recording the review in history
 * 6. Auto-suppressing persistent findings that exceed the churn threshold
 */

import type { JanitorConfig } from '../config/schema';
import { fingerprint } from '../findings/fingerprint';
import { analyzeLifecycle, detectResolved } from '../history/analyzer';
import type { EnrichmentData } from '../history/enrichment';
import type { HistoryStore } from '../history/store';
import { computeTrends } from '../history/trends';
import type { ReviewRecord } from '../history/types';
import type { JanitorOutput } from '../schemas/finding';
import { JanitorOutput as JanitorOutputSchema } from '../schemas/finding';
import { createSuppression } from '../suppressions/lifecycle';
import { matchSuppression } from '../suppressions/matcher';
import type { SuppressionStore } from '../suppressions/store';
import type { Finding, ReviewResult } from '../types';
import { log } from '../utils/logger';
import { parseAgentOutput } from './agent-output-codec';

export interface PipelineResult {
  result: ReviewResult;
  enrichment?: EnrichmentData;
  suppressedCount: number;
}

export interface PipelineDeps {
  suppressionStore: SuppressionStore;
  historyStore: HistoryStore;
  config: JanitorConfig;
}

/**
 * Process raw review output through the full post-processing pipeline.
 *
 * This is the single entry point that replaces direct parseReviewOutput
 * calls in the queue. The flow:
 *
 *   raw text → parse → suppress → annotate → enrich → record → result
 */
export async function processReviewOutput(
  raw: string,
  sha: string,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const { suppressionStore, historyStore, config } = deps;

  // Step 1: Parse raw output into findings
  const { output, meta } = parseAgentOutput(raw, JanitorOutputSchema);
  if (meta.status !== 'ok') {
    throw new Error(`Janitor parse failed (${meta.status}): ${meta.error}`);
  }
  const parsed: ReviewResult = {
    sha,
    subject: '',
    date: new Date(),
    findings: output.findings.map((f) => ({
      location: f.location,
      severity: f.severity,
      evidence: f.evidence,
      prescription: f.prescription,
      domain: f.domain,
    })),
    clean: output.findings.length === 0,
    raw,
  };

  // If both memory systems are disabled, short-circuit
  const suppressionsEnabled = config.suppressions?.enabled ?? true;
  const historyEnabled = config.history?.enabled ?? true;

  if (!suppressionsEnabled && !historyEnabled) {
    return { result: parsed, suppressedCount: 0 };
  }

  // Step 2: Filter suppressed findings
  let findings = parsed.findings;
  let suppressedCount = 0;

  if (suppressionsEnabled) {
    const activeSups = suppressionStore.getActive();
    const kept: Finding[] = [];
    const touchedKeys: string[] = [];

    for (const finding of findings) {
      const match = matchSuppression(finding, activeSups);
      if (match.matched) {
        suppressedCount++;
        // Collect key to batch-touch after the loop
        touchedKeys.push(match.suppression.exactKey);
        log(
          `[pipeline] suppressed: ${finding.domain} @ ${finding.location} (${match.tier})`,
        );
      } else {
        kept.push(finding);
      }
    }

    if (touchedKeys.length > 0) {
      suppressionStore.touchMany(touchedKeys);
    }

    findings = kept;
  }

  // Build the filtered result
  const result: ReviewResult = {
    ...parsed,
    findings,
    clean: findings.length === 0,
  };

  // Step 3-5: History analysis + enrichment (if enabled)
  let enrichment: EnrichmentData | undefined;

  if (historyEnabled) {
    const ledger = historyStore.getLedger();

    // Annotate lifecycle
    const annotated = analyzeLifecycle(findings, ledger);

    // Detect resolved findings
    const currentExactKeys = new Set(annotated.map((a) => a.exactKey));
    const currentScopedKeys = new Set(annotated.map((a) => a.scopedKey));
    const resolved = detectResolved(
      currentExactKeys,
      currentScopedKeys,
      ledger,
    );

    // Record this review BEFORE computing trends so the current review
    // is included in the trend window — otherwise the report is always
    // one review behind.
    const record: ReviewRecord = {
      sha,
      subject: parsed.subject,
      date: new Date().toISOString(),
      findings: findings.map((f) => {
        const fp = fingerprint(f);
        return {
          exactKey: fp.exactKey,
          scopedKey: fp.scopedKey,
          domain: f.domain,
          location: f.location,
        };
      }),
      findingCount: findings.length,
      clean: findings.length === 0,
    };
    historyStore.addReview(record);

    // Compute trends (now includes the just-recorded review)
    const trendWindow = config.history?.trendWindow ?? 10;
    const trends = computeTrends(historyStore.getReviews(), trendWindow);

    enrichment = { annotatedFindings: annotated, resolved, trends };

    log(
      `[pipeline] history: ${annotated.length} annotated, ${resolved.length} resolved`,
    );
  }

  // Step 6: Auto-suppress persistent findings that exceed churn threshold
  if (suppressionsEnabled && enrichment) {
    const churnThreshold = config.suppressions?.autoSuppressThreshold ?? 0.6;
    const ttlDays = config.suppressions?.ttlDays ?? 90;

    // churnThreshold=1 means "never auto-suppress" — skip entirely
    if (churnThreshold >= 1) {
      // noop — auto-suppression disabled
    } else {
      for (const annotated of enrichment.annotatedFindings) {
        if (annotated.lifecycle !== 'persistent') continue;

        // Only auto-suppress after several consecutive appearances
        const minStreak = Math.ceil(1 / (1 - churnThreshold));
        if (annotated.streak >= minStreak) {
          const suppression = createSuppression(annotated.finding, sha, {
            tier: 'exact',
            reason: `Auto-suppressed: seen in ${annotated.streak} consecutive reviews`,
            ttlDays,
          });
          suppressionStore.add(suppression);
          log(
            `[pipeline] auto-suppressed: ${annotated.finding.domain} @ ${annotated.finding.location}`,
          );
        }
      }
    }
  }

  return { result, enrichment, suppressedCount };
}
