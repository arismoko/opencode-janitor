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

type PrModuleDeps = {
  now?: () => number;
  resolveCurrentPrKeyAsync?: (repoPath: string) => Promise<string | null>;
};

export function createPrTriggerModule(deps?: PrModuleDeps) {
  const now = deps?.now ?? Date.now;
  const resolvePrKey =
    deps?.resolveCurrentPrKeyAsync ?? resolveCurrentPrKeyAsync;

  return {
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
      const nowMs = now();
      const prKey = await resolvePrKey(repoPath);
      const nextCheckAt = nowMs + Math.max(1, config.intervalSec) * 1000;

      if (!prKey) {
        return {
          nextState: {
            ...state,
            lastCheckedAt: nowMs,
            nextCheckAt,
          },
          emissions: [],
        };
      }

      if (state.lastPrKey === prKey) {
        return {
          nextState: {
            ...state,
            lastCheckedAt: nowMs,
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
          lastCheckedAt: nowMs,
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
            detectedAt: nowMs,
          },
        ],
      };
    },
  };
}

export const PR_TRIGGER_MODULE = createPrTriggerModule();
