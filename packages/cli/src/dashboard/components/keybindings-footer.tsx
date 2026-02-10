import { Box, Text } from 'ink';
import type { FocusPane, ViewMode } from '../types';

export interface KeybindingsFooterProps {
  viewMode: ViewMode;
  focusPane: FocusPane;
  /** Whether `t` toggle is contextually available (report detail of completed run). */
  showToggle: boolean;
}

export function KeybindingsFooter(props: KeybindingsFooterProps) {
  const { viewMode, focusPane, showToggle } = props;

  let content: string;

  if (viewMode === 'reports' && focusPane === 'detail') {
    const toggle = showToggle ? ' t toggle ╎' : '';
    content = `1/2/3 view ╎ j/k scroll  h/esc back ╎ y copy  D del  R run ╎${toggle} r refresh  p pause  q quit`;
  } else if (viewMode === 'reports') {
    content =
      '1/2/3 view ╎ j/k move  g/G jump ╎ Enter open ╎ y copy  D del  R run ╎ r refresh  p pause  q quit';
  } else if (viewMode === 'activity') {
    content =
      '1/2/3 view ╎ j/k scroll  g/G jump ╎ f filter ╎ r refresh  p pause  q quit';
  } else {
    // repos
    content =
      '1/2/3 view ╎ j/k move  g/G jump ╎ R run ╎ r refresh  p pause  q quit';
  }

  return (
    <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="gray">{content}</Text>
    </Box>
  );
}
