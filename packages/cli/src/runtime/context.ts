/**
 * CLI runtime context — composition boundary + consumer projections.
 */

import type { ConfigContext } from './context/config-context';
import type { RuntimeServicesContext } from './context/runtime-services-context';

export interface RuntimeContext extends ConfigContext, RuntimeServicesContext {}

/** Projection for daemon socket status handlers. */
export type SocketContext = Pick<
  RuntimeContext,
  'startedAt' | 'dbPath' | 'config'
>;

/** Projection for runtime teardown/shutdown paths. */
export type ShutdownContext = Pick<
  RuntimeContext,
  'watch' | 'scheduler' | 'completionBus' | 'db' | 'child' | 'lock'
>;
