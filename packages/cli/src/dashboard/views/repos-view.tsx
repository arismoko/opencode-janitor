import { Box, Text } from 'ink';
import { Pane } from '../components/pane';
import { ScrollableList } from '../components/scrollable-list';
import { etaLabel, repoStateTone, shortRepoName, truncate } from '../helpers';
import type { DashboardRepoState } from '../types';

export interface ReposViewProps {
  repos: DashboardRepoState[];
  repoIndex: number;
  isNarrow: boolean;
  repoWindowStart: number;
  visibleRepoRows: number;
  termCols: number;
  nowTs: number;
}

function renderRepoItem(
  repo: DashboardRepoState,
  _absIdx: number,
  selected: boolean,
  innerWidth: number,
) {
  const tone = repoStateTone(repo);
  const marker = selected ? '>' : ' ';

  // Fixed-width column layout constrained to innerWidth.
  // Shape: marker(1) ·dot(1) ·name(W) ·label(W) ·jobs(W)
  // Total = 5 + nameW + labelW + jobsW  (5 = marker + dot + 3 separating spaces)
  const labelW = 8;
  const jobsW = 9;
  const nameW = Math.max(6, innerWidth - 5 - labelW - jobsW);
  const jobsStr = `r${repo.runningJobs} q${repo.queuedJobs}`;

  return (
    <>
      <Text color={selected ? 'cyan' : 'gray'}>{marker}</Text>
      <Text color={tone.color}> {tone.dot}</Text>
      <Text color={selected ? 'white' : 'gray'}>
        {' '}
        {truncate(shortRepoName(repo.path), nameW).padEnd(nameW)}
      </Text>
      <Text color="gray"> {truncate(tone.label, labelW).padEnd(labelW)}</Text>
      <Text color="gray" dimColor>
        {' '}
        {truncate(jobsStr, jobsW)}
      </Text>
    </>
  );
}

export function ReposView(props: ReposViewProps) {
  const {
    repos,
    repoIndex,
    isNarrow,
    repoWindowStart,
    visibleRepoRows,
    termCols,
    nowTs,
  } = props;

  const selectedRepo = repos[repoIndex] ?? null;

  // Pane border (2) + paddingX (2) = 4 chars of horizontal overhead
  const listPaneWidth = isNarrow ? termCols : 48;
  const listInnerWidth = listPaneWidth - 4;
  const detailInnerWidth = isNarrow ? termCols - 4 : termCols - 48 - 1 - 4;

  return (
    <Box flexDirection={isNarrow ? 'column' : 'row'} flexGrow={1}>
      <Pane
        title={`Repos (${repos.length})`}
        focused
        width={isNarrow ? undefined : 48}
      >
        <ScrollableList
          items={repos}
          selectedIndex={repoIndex}
          windowStart={repoWindowStart}
          visibleRows={visibleRepoRows}
          keyExtractor={(r) => r.id}
          emptyMessage="No tracked repos."
          renderItem={(repo, absIdx, selected) =>
            renderRepoItem(repo, absIdx, selected, listInnerWidth)
          }
        />
      </Pane>

      <Pane
        title="Repo Detail"
        marginLeft={isNarrow ? 0 : 1}
        marginTop={isNarrow ? 1 : 0}
      >
        {selectedRepo ? (
          <Box flexDirection="column">
            <Text color="white" bold>
              {truncate(selectedRepo.path, detailInnerWidth)}
            </Text>
            <Text color="gray">
              branch {selectedRepo.defaultBranch} -- idle streak{' '}
              {selectedRepo.idleStreak}
            </Text>
            <Text color="gray">
              commit {etaLabel(selectedRepo.nextCommitCheckAt, nowTs)} -- pr{' '}
              {etaLabel(selectedRepo.nextPrCheckAt, nowTs)}
            </Text>
            <Text color="gray">
              jobs running {selectedRepo.runningJobs} -- queued{' '}
              {selectedRepo.queuedJobs}
            </Text>
          </Box>
        ) : (
          <Text color="gray">Select a repo to inspect.</Text>
        )}
      </Pane>
    </Box>
  );
}
