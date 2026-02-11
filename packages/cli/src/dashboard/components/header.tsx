import { Box, Text } from 'ink';
import { shortDuration, streamStateColor } from '../helpers';
import type { StreamState, ViewMode } from '../types';
import { ViewTabs } from './view-tabs';

export interface HeaderProps {
  viewMode: ViewMode;
  streamState: StreamState;
  paused: boolean;
  reposEnabled: number;
  reposTotal: number;
  runningJobs: number;
  queuedJobs: number;
  reportsCount: number;
  uptimeMs: number;
  lastRefreshAgoMs: number;
}

export function Header(props: HeaderProps) {
  const {
    viewMode,
    streamState,
    paused,
    reposEnabled,
    reposTotal,
    runningJobs,
    queuedJobs,
    reportsCount,
    uptimeMs,
    lastRefreshAgoMs,
  } = props;

  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      flexDirection="column"
    >
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="cyan">
            JANITOR{' '}
          </Text>
          <ViewTabs current={viewMode} />
        </Box>
        <Box>
          <Text color={streamStateColor(streamState)}>
            ● {streamState.toUpperCase()}
            {paused ? ' (PAUSED)' : ''}
          </Text>
        </Box>
      </Box>
      <Box justifyContent="space-between">
        <Text color="gray">
          repos {reposEnabled}/{reposTotal} · jobs {runningJobs}r/{queuedJobs}q
          · reports {reportsCount}
        </Text>
        <Text color="gray">
          uptime {shortDuration(uptimeMs)} · refresh{' '}
          {shortDuration(lastRefreshAgoMs)} ago
        </Text>
      </Box>
    </Box>
  );
}
