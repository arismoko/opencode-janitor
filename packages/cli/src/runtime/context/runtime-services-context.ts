import type { Database } from 'bun:sqlite';
import type { ProcessLock } from '../../daemon/lock';
import type { RepoWatchHandle } from '../../detectors/repo-watch';
import type { SchedulerHandle } from '../../scheduler/worker';
import type { AgentRuntimeRegistry } from '../agent-runtime-registry';
import type { OpencodeChild } from '../opencode-child';
import type { SessionCompletionBus } from '../session-completion-bus';

/** Runtime-owned services with lifecycle/teardown requirements. */
export interface RuntimeServicesContext {
  lock: ProcessLock;
  db: Database;
  child: OpencodeChild;
  registry: AgentRuntimeRegistry;
  completionBus: SessionCompletionBus;
  watch: RepoWatchHandle;
  scheduler: SchedulerHandle;
}
