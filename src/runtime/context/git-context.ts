/**
 * Git and detection context slice.
 */

import type { CommitDetector } from '../../git/commit-detector';
import type { PrDetector } from '../../git/pr-detector';
import type { Exec } from '../runtime-types';

export interface GitContext {
  exec: Exec;
  gitDir: string;
  detector: CommitDetector;
  prDetector: PrDetector | null;
  ghAvailableAtStartup: boolean;
  branchPushPending: boolean;
}
