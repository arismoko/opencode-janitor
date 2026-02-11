import { COMMIT_TRIGGER_DEFINITION } from './definitions/commit';
import { MANUAL_TRIGGER_DEFINITION } from './definitions/manual';
import { PR_TRIGGER_DEFINITION } from './definitions/pr';

export { COMMIT_TRIGGER_DEFINITION } from './definitions/commit';
export { MANUAL_TRIGGER_DEFINITION } from './definitions/manual';
export { PR_TRIGGER_DEFINITION } from './definitions/pr';
export type {
  TriggerContext,
  TriggerDefinition,
  TriggerProbeResult,
} from './types';

export const TRIGGERS = {
  commit: COMMIT_TRIGGER_DEFINITION,
  pr: PR_TRIGGER_DEFINITION,
  manual: MANUAL_TRIGGER_DEFINITION,
} as const;

export type TriggerId = keyof typeof TRIGGERS;

export const TRIGGER_IDS: readonly TriggerId[] = Object.keys(
  TRIGGERS,
) as TriggerId[];

export function isTriggerId(value: string): value is TriggerId {
  return value in TRIGGERS;
}
