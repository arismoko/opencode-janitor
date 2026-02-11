import { COMMIT_TRIGGER_DEFINITION } from '@opencode-janitor/shared';
import { resolveHeadShaAsync } from '../../utils/git';

type CommitState = {
  lastHeadSha?: string;
  nextCheckAt?: number;
  lastCheckedAt?: number;
};

type CommitConfig = {
  enabled: boolean;
  intervalSec: number;
};

export const COMMIT_TRIGGER_MODULE = {
  ...COMMIT_TRIGGER_DEFINITION,
  probe: async ({
    repoPath,
    state,
    config,
  }: {
    repoPath: string;
    state: CommitState;
    config: CommitConfig;
  }) => {
    const now = Date.now();
    const headSha = await resolveHeadShaAsync(repoPath);
    const nextCheckAt = now + Math.max(1, config.intervalSec) * 1000;

    if (state.lastHeadSha === headSha) {
      return {
        nextState: {
          ...state,
          lastCheckedAt: now,
          nextCheckAt,
        },
        emissions: [],
      };
    }

    return {
      nextState: {
        ...state,
        lastHeadSha: headSha,
        lastCheckedAt: now,
        nextCheckAt,
      },
      emissions: [
        {
          eventKey: headSha,
          payload: { sha: headSha },
          detectedAt: now,
        },
      ],
    };
  },
};
