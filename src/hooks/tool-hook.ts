/**
 * Tool execution hook — accelerates commit/PR detection on git commands.
 */

import type { RuntimeContext } from '../runtime/context';

/**
 * Create the tool.execute.after hook handler.
 *
 * Watches for bash tool invocations that look like git commit, git push,
 * or gh pr commands and accelerates the corresponding detector so reviews
 * trigger immediately instead of waiting for the next poll cycle.
 */
export function createToolHook(
  rc: RuntimeContext,
): (
  input: { tool: string; sessionID: string; callID: string },
  output: { title: string; output: string; metadata: unknown },
) => Promise<void> {
  return async (input, output) => {
    if (rc.runtime.disposed) return;
    if (input.tool !== 'Bash' && input.tool !== 'bash') return;

    const text = output.title || output.output || '';

    if (rc.anyCommitReviews && /git\s+commit/.test(text)) {
      rc.detector.accelerate();
    }

    if (!rc.prDetector || !rc.config.pr.detectToolHook) return;

    if (/git\s+push/.test(text)) {
      if (!rc.ghAvailableAtStartup) {
        rc.branchPushPending = true;
      }
      rc.prDetector.accelerate();
      return;
    }

    if (/gh\s+pr\s+(create|ready|reopen|edit|merge)/.test(text)) {
      rc.prDetector.accelerate();
    }
  };
}
