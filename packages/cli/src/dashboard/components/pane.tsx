import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

export interface PaneProps {
  title: string;
  focused?: boolean;
  width?: number;
  marginLeft?: number;
  marginTop?: number;
  children: ReactNode;
}

export function Pane(props: PaneProps) {
  const {
    title,
    focused = false,
    width,
    marginLeft,
    marginTop,
    children,
  } = props;

  return (
    <Box
      width={width}
      marginLeft={marginLeft}
      marginTop={marginTop}
      flexGrow={width ? undefined : 1}
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? 'cyan' : 'gray'}
      paddingX={1}
    >
      <Text bold color={focused ? 'cyan' : 'white'}>
        {title}
      </Text>
      {children}
    </Box>
  );
}
