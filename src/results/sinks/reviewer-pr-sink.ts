import { isGhAvailable, postPrReviewWithGh } from '../../git/gh-pr';

/**
 * Deliver reviewer output directly as a PR review comment via gh CLI.
 * Returns false when gh is unavailable or posting fails.
 */
export async function deliverReviewerToPr(
  exec: (cmd: string) => Promise<string>,
  prNumber: number,
  report: string,
): Promise<boolean> {
  if (!(await isGhAvailable(exec))) {
    return false;
  }
  return postPrReviewWithGh(exec, prNumber, report);
}
