/**
 * Queue and orchestration context slice.
 */

import type { PrContext } from '../../git/pr-context-resolver';
import type { ReviewRunQueue } from '../../review/review-run-queue';
import type { HunterResult, ReviewResult } from '../../types';

export interface QueueContext {
  orchestrator: ReviewRunQueue<string, ReviewResult>;
  hunterOrchestrator: ReviewRunQueue<PrContext, HunterResult>;
}
