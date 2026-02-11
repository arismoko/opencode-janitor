import { Box, Text } from 'ink';
import { severityColor } from '../helpers';
import type { DashboardFinding } from '../types';

export interface FindingRowProps {
  finding: DashboardFinding;
  width: number;
}

export function FindingRow({ finding, width }: FindingRowProps) {
  const sevColor = severityColor(finding.severity);

  return (
    <Box flexDirection="column" marginBottom={1} width={width}>
      {/* Header: severity + domain + location */}
      <Box>
        <Text color={sevColor} bold>
          {finding.severity}
        </Text>
        <Text color="white"> {finding.domain}</Text>
        {finding.location && (
          <Text color="gray" dimColor>
            {' '}
            @ {finding.location}
          </Text>
        )}
      </Box>

      {/* Evidence — full text, wraps naturally */}
      <Box marginLeft={2} width={Math.max(10, width - 2)}>
        <Text wrap="wrap">{finding.evidence}</Text>
      </Box>

      {/* Prescription — full text, wraps naturally */}
      {finding.prescription && (
        <Box marginLeft={2} width={Math.max(10, width - 2)}>
          <Text color="green" dimColor wrap="wrap">
            {'> '}
            {finding.prescription}
          </Text>
        </Box>
      )}
    </Box>
  );
}
