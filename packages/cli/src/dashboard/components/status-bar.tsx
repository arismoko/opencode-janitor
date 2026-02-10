import { Box, Text } from 'ink';
import { truncate } from '../helpers';

export interface StatusBarProps {
  streamError: string | null;
  refreshError: string | null;
  bufferedWhilePaused: number;
  paused: boolean;
  termWidth: number;
  flashMessage: string | null;
  flashTone?: 'green' | 'yellow' | 'red' | 'cyan';
}

export function StatusBar(props: StatusBarProps) {
  const {
    streamError,
    refreshError,
    bufferedWhilePaused,
    paused,
    termWidth,
    flashMessage,
    flashTone = 'green',
  } = props;

  const hasContent =
    flashMessage ||
    streamError ||
    refreshError ||
    (bufferedWhilePaused > 0 && paused);

  if (!hasContent) return null;

  // When a flash message is active, show it exclusively to avoid
  // visual clutter from concurrent persistent errors.
  if (flashMessage) {
    return (
      <Box marginTop={1}>
        <Text color={flashTone}>{truncate(flashMessage, termWidth - 2)}</Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1} flexDirection="column">
      {streamError && (
        <Text color="red">
          stream error: {truncate(streamError, termWidth - 15)}
        </Text>
      )}
      {refreshError && (
        <Text color="yellow">
          snapshot error: {truncate(refreshError, termWidth - 18)}
        </Text>
      )}
      {bufferedWhilePaused > 0 && paused && (
        <Text color="yellow">
          {bufferedWhilePaused} event(s) buffered while paused
        </Text>
      )}
    </Box>
  );
}
