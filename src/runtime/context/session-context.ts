/**
 * Session lifecycle, persistence, and control context slice.
 */

import type { HistoryStore } from '../../history/store';
import type { RuntimeStateStore } from '../../state/store';
import type { SuppressionStore } from '../../suppressions/store';
import type { AgentControl, RuntimeFlag } from '../context';

export interface SessionContext {
  stateDir: string;
  store: RuntimeStateStore;
  suppressionStore: SuppressionStore;
  historyStore: HistoryStore;
  trackedSessions: Set<string>;
  control: AgentControl;
  runtime: RuntimeFlag;
  writeSessionMeta: (
    sessionId: string,
    meta: {
      title: string;
      agent: string;
      key: string;
      status: string;
      startedAt: number;
      completedAt?: number;
    },
  ) => void;
}
