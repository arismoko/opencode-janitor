/**
 * Queue and orchestration context slice.
 */

import type { PrContext } from '../../git/pr-context-resolver';
import type { ReviewRunQueue } from '../../review/review-run-queue';
import type { HunterResult, InspectorResult, ReviewResult } from '../../types';
import type { SessionOwnershipDispatcher } from '../session-ownership-dispatcher';

export interface QueueContext {
  janitorQueue: ReviewRunQueue<string, ReviewResult>;
  hunterQueue: ReviewRunQueue<PrContext, HunterResult>;
  inspectorQueue: ReviewRunQueue<string, InspectorResult>;
  dispatcher: SessionOwnershipDispatcher;
}
