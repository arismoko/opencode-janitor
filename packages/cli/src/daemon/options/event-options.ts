import {
  listEventsAfterSeq,
  listEventsAfterSeqFiltered,
} from '../../db/queries/event-queries';
import type { RuntimeContext } from '../../runtime/context';
import type { EventApi } from '../socket-types';

export function createEventOptions(rc: RuntimeContext): EventApi {
  return {
    listEventsAfterSeq: (afterSeq, limit) =>
      listEventsAfterSeq(rc.db, afterSeq, limit),
    listEventsAfterSeqFiltered: (afterSeq, limit, filters) =>
      listEventsAfterSeqFiltered(rc.db, afterSeq, limit, filters),
  };
}
