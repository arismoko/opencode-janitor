import { Box, Text } from 'ink';
import { Pane } from '../components/pane';
import { levelColor, shortClock, truncate } from '../helpers';
import type { EventJournalEntry } from '../types';

export interface ActivityViewProps {
  events: EventJournalEntry[];
  visibleEvents: EventJournalEntry[];
  repoNameById: Record<string, string>;
  levelFilter: 'all' | 'info+' | 'warn+' | 'error';
  termCols: number;
  /** Scroll offset from the bottom (0 = latest) */
  scrollOffset: number;
}

export function ActivityView(props: ActivityViewProps) {
  const {
    events,
    visibleEvents,
    repoNameById,
    levelFilter,
    termCols,
    scrollOffset,
  } = props;

  // Build title with scroll position context
  const total = events.length;
  const viewingEnd = total - scrollOffset;
  const viewingStart = Math.max(1, viewingEnd - visibleEvents.length + 1);
  const rangeLabel =
    total === 0
      ? '0'
      : scrollOffset === 0
        ? `${total} latest`
        : `${viewingStart}-${viewingEnd} of ${total}`;

  const title = `Activity (${rangeLabel})  filter:${levelFilter}`;

  // Adaptive column budgets for single-line layout
  const narrow = termCols < 100;
  const eventTypeBudget = narrow
    ? Math.max(12, Math.floor(termCols * 0.18))
    : Math.max(16, Math.floor(termCols * 0.2));
  const repoBudget = narrow ? 10 : 14;
  const messageBudget = Math.max(
    10,
    termCols - eventTypeBudget - repoBudget - 17,
  );

  return (
    <Pane title={title} focused>
      {visibleEvents.length === 0 ? (
        <Text color="gray">No events match the current filter.</Text>
      ) : (
        visibleEvents.map((event) => {
          const repoName = event.repoId
            ? (repoNameById[event.repoId] ?? event.repoId.slice(0, 8))
            : '-';
          return (
            <Box key={event.eventId}>
              <Text color="gray">{shortClock(event.ts)}</Text>
              <Text color={levelColor(event.level)}>
                {' '}
                {event.level.toUpperCase().padEnd(5, ' ')}
              </Text>
              <Text color="cyan">
                {' '}
                {truncate(event.topic, eventTypeBudget).padEnd(
                  eventTypeBudget,
                  ' ',
                )}
              </Text>
              <Text color="gray">
                {' '}
                {truncate(repoName, repoBudget).padEnd(repoBudget, ' ')}
              </Text>
              <Text color="white" wrap="truncate-end">
                {' '}
                {truncate(event.message, messageBudget)}
              </Text>
            </Box>
          );
        })
      )}
      {scrollOffset > 0 && (
        <Text color="yellow" dimColor>
          ↓ {scrollOffset} newer event{scrollOffset !== 1 ? 's' : ''} below (j
          to scroll down)
        </Text>
      )}
    </Pane>
  );
}
