import type { AgentId } from '../agents';
import type {
  AnyFinding as _AnyFinding,
  FindingByAgent as _FindingByAgent,
  Severity as _Severity,
} from '../review/finding-schemas';

export type Severity = _Severity;
export type FindingByAgent<TAgent extends AgentId> = _FindingByAgent<TAgent>;
export type AnyFinding = _AnyFinding;

export type ParseStatus = 'ok' | 'invalid_output' | 'empty_output';

export interface ParseMeta {
  status: ParseStatus;
  error?: string;
}
