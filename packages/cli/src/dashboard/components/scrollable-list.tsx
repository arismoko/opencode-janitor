import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

export interface ScrollableListProps<T> {
  items: T[];
  selectedIndex: number;
  windowStart: number;
  visibleRows: number;
  renderItem: (item: T, index: number, selected: boolean) => ReactNode;
  emptyMessage?: string;
  keyExtractor: (item: T) => string;
}

export function ScrollableList<T>(props: ScrollableListProps<T>) {
  const {
    items,
    selectedIndex,
    windowStart,
    visibleRows,
    renderItem,
    emptyMessage = 'No items.',
    keyExtractor,
  } = props;

  if (items.length === 0) {
    return <Text color="gray">{emptyMessage}</Text>;
  }

  const visibleItems = items.slice(windowStart, windowStart + visibleRows);

  return (
    <Box flexDirection="column">
      {visibleItems.map((item, idx) => {
        const absIdx = windowStart + idx;
        const selected = absIdx === selectedIndex;
        return (
          <Box key={keyExtractor(item)}>
            {renderItem(item, absIdx, selected)}
          </Box>
        );
      })}
    </Box>
  );
}
