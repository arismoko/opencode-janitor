import {
  ANTI_PATTERN_LABEL_VALUES,
  RECOMMENDED_PATTERN_LABEL_VALUES,
} from './schema';

const antiPatternLabels = new Set(ANTI_PATTERN_LABEL_VALUES);
const recommendedPatternLabels = new Set(RECOMMENDED_PATTERN_LABEL_VALUES);

const ANTI_PATTERN_ALIASES: Record<string, string> = {
  BIGBALL_OF_MUD: 'BIG_BALL_OF_MUD',
  BIG_BALL_OF_MUD_PATTERN: 'BIG_BALL_OF_MUD',
  SHOTGUN_SURGERIES: 'SHOTGUN_SURGERY',
  BOOLEAN_FLAG_PARAMETER: 'BOOLEAN_PARAMETER',
};

const RECOMMENDED_PATTERN_ALIASES: Record<string, string> = {
  TEMPLATE: 'TEMPLATE_METHOD',
  TEMPLATEMETHOD: 'TEMPLATE_METHOD',
  TEMPLATE_METHOD_PATTERN: 'TEMPLATE_METHOD',
  PORTS_AND_ADAPTERS: 'HEXAGONAL_PORTS_ADAPTERS',
  PORTS_ADAPTERS: 'HEXAGONAL_PORTS_ADAPTERS',
  HEXAGONAL: 'HEXAGONAL_PORTS_ADAPTERS',
  HEXAGONAL_ARCHITECTURE: 'HEXAGONAL_PORTS_ADAPTERS',
  CLEAN: 'CLEAN_ARCHITECTURE',
  CLEAN_ARCH: 'CLEAN_ARCHITECTURE',
  PUBLISH_SUBSCRIBE_PATTERN: 'PUBLISH_SUBSCRIBE',
  PUB_SUB: 'PUBLISH_SUBSCRIBE',
};

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value
    .trim()
    .replace(/[&/-]+/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .toUpperCase();
}

export function normalizeInspectorFinding(
  finding: Record<string, unknown>,
): void {
  const architecture = finding.architecture;
  if (!architecture || typeof architecture !== 'object') {
    return;
  }

  const architectureRecord = architecture as Record<string, unknown>;

  const antiPattern = architectureRecord.antiPattern;
  if (antiPattern && typeof antiPattern === 'object') {
    const antiPatternRecord = antiPattern as Record<string, unknown>;
    const normalizedLabel = normalizeLabel(antiPatternRecord.label);
    if (normalizedLabel) {
      const canonical =
        ANTI_PATTERN_ALIASES[normalizedLabel] ?? normalizedLabel;
      if (
        antiPatternLabels.has(
          canonical as (typeof ANTI_PATTERN_LABEL_VALUES)[number],
        )
      ) {
        antiPatternRecord.label = canonical;
      }
    }
  }

  const recommendedPattern = architectureRecord.recommendedPattern;
  if (recommendedPattern && typeof recommendedPattern === 'object') {
    const recommendedPatternRecord = recommendedPattern as Record<
      string,
      unknown
    >;
    const normalizedLabel = normalizeLabel(recommendedPatternRecord.label);
    if (normalizedLabel) {
      const canonical =
        RECOMMENDED_PATTERN_ALIASES[normalizedLabel] ?? normalizedLabel;
      if (
        recommendedPatternLabels.has(
          canonical as (typeof RECOMMENDED_PATTERN_LABEL_VALUES)[number],
        )
      ) {
        recommendedPatternRecord.label = canonical;
      }
    }
  }
}
