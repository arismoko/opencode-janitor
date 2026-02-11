import type { RuntimeServicesContext } from './runtime-services-context';

/** Narrow projection used by shutdown and scheduler coordination flows. */
export type SchedulerContext = Pick<
  RuntimeServicesContext,
  'watch' | 'scheduler' | 'completionBus'
>;
