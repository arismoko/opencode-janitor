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
import { createSuppression } from '../suppressions/lifecycle';
import { matchSuppression } from '../suppressions/matcher';
import type { SuppressionStore } from '../suppressions/store';
import type { Finding, ReviewResult } from '../types';
import { log } from '../utils/logger';
import { parseReviewOutput } from './parser';

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
 * calls in the orchestrator. The flow:
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
  const parsed = parseReviewOutput(raw, sha);

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

    for (const finding of findings) {
      const match = matchSuppression(finding, activeSups);
      if (match.matched) {
        suppressedCount++;
        // Touch the suppression to refresh its TTL
        suppressionStore.touch(match.suppression);
        log(
          `[pipeline] suppressed: ${finding.category} @ ${finding.location} (${match.tier})`,
        );
      } else {
        kept.push(finding);
      }
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
    const currentKeys = new Set(annotated.map((a) => a.exactKey));
    const resolved = detectResolved(currentKeys, ledger);

    // Compute trends
    const trendWindow = config.history?.trendWindow ?? 10;
    const trends = computeTrends(historyStore.getReviews(), trendWindow);

    enrichment = { annotatedFindings: annotated, resolved, trends };

    // Record this review
    const record: ReviewRecord = {
      sha,
      subject: parsed.subject,
      date: new Date().toISOString(),
      findings: findings.map((f) => {
        const fp = fingerprint(f);
        return {
          exactKey: fp.exactKey,
          scopedKey: fp.scopedKey,
          category: f.category,
          location: f.location,
        };
      }),
      findingCount: findings.length,
      clean: findings.length === 0,
    };
    historyStore.addReview(record);

    log(
      `[pipeline] history: ${annotated.length} annotated, ${resolved.length} resolved`,
    );
  }

  // Step 6: Auto-suppress persistent findings that exceed churn threshold
  if (suppressionsEnabled && enrichment) {
    const churnThreshold = config.suppressions?.revalidationChurn ?? 0.6;
    const ttlDays = config.suppressions?.ttlDays ?? 90;

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
          `[pipeline] auto-suppressed: ${annotated.finding.category} @ ${annotated.finding.location}`,
        );
      }
    }
  }

  return { result, enrichment, suppressedCount };
}
