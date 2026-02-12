import { PR_TRIGGER_DEFINITION } from '@opencode-janitor/shared';
import { resolveCurrentPrKeyAsync } from '../../utils/git';

type PrState = {
  lastPrKey?: string;
  nextCheckAt?: number;
  lastCheckedAt?: number;
};

type PrConfig = {
  enabled: boolean;
  intervalSec: number;
  ttlSec: number;
};

function parsePrKey(prKey: string): { prNumber: number; sha: string } {
  const [numberRaw, shaRaw] = prKey.split(':');
  const prNumber = Number.parseInt(numberRaw ?? '', 10);
  const sha = (shaRaw ?? '').trim();
  if (!Number.isInteger(prNumber) || prNumber <= 0 || sha.length === 0) {
    throw new Error(`Invalid PR key: ${prKey}`);
  }
  return { prNumber, sha };
}

export const PR_TRIGGER_MODULE = {
  ...PR_TRIGGER_DEFINITION,
  probe: async ({
    repoPath,
    state,
    config,
  }: {
    repoPath: string;
    state: PrState;
    config: PrConfig;
  }) => {
    const now = Date.now();
    const prKey = await resolveCurrentPrKeyAsync(repoPath);
    const nextCheckAt = now + Math.max(1, config.intervalSec) * 1000;

    if (!prKey || state.lastPrKey === prKey) {
      return {
        nextState: {
          ...state,
          lastPrKey: prKey ?? state.lastPrKey,
          lastCheckedAt: now,
          nextCheckAt,
        },
        emissions: [],
      };
    }

    const { prNumber, sha } = parsePrKey(prKey);
    return {
      nextState: {
        ...state,
        lastPrKey: prKey,
        lastCheckedAt: now,
        nextCheckAt,
      },
      emissions: [
        {
          eventKey: prKey,
          payload: {
            prNumber,
            key: prKey,
            sha,
          },
          detectedAt: now,
        },
      ],
    };
  },
};
