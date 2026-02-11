import { Box, Text } from 'ink';
import type { ViewMode } from '../types';

const TABS: Array<{ key: string; label: string; mode: ViewMode }> = [
  { key: '1', label: 'Reports', mode: 'reports' },
  { key: '2', label: 'Repos', mode: 'repos' },
  { key: '3', label: 'Activity', mode: 'activity' },
];

export interface ViewTabsProps {
  current: ViewMode;
}

export function ViewTabs({ current }: ViewTabsProps) {
  return (
    <Box>
      {TABS.map((tab) => {
        const active = tab.mode === current;
        return (
          <Box key={tab.key} marginRight={1}>
            <Text
              color={active ? 'cyan' : 'gray'}
              bold={active}
              underline={active}
            >
              [{tab.key}] {tab.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
