import { INSPECTOR_AGENT_DEFINITION } from './definition';
import { normalizeInspectorFinding } from './normalizer';
import { InspectorOutput } from './schema';

export const AGENT_DEFINITION = INSPECTOR_AGENT_DEFINITION;
export const OUTPUT_SCHEMA = InspectorOutput;
export const normalizeFinding = normalizeInspectorFinding;
export const ORDER = 2;

export { INSPECTOR_AGENT_DEFINITION } from './definition';
export { normalizeInspectorFinding } from './normalizer';
export * from './schema';
