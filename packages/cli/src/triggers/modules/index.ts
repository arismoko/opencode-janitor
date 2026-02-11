import { COMMIT_TRIGGER_MODULE } from './commit';
import { MANUAL_TRIGGER_MODULE } from './manual';
import { PR_TRIGGER_MODULE } from './pr';

export { COMMIT_TRIGGER_MODULE } from './commit';
export { MANUAL_TRIGGER_MODULE } from './manual';
export { PR_TRIGGER_MODULE } from './pr';

export const TRIGGER_MODULES = {
  commit: COMMIT_TRIGGER_MODULE,
  pr: PR_TRIGGER_MODULE,
  manual: MANUAL_TRIGGER_MODULE,
} as const;
