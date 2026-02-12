import type { ScopeDefinition } from '../types';

export const COMMIT_DIFF_SCOPE_DEFINITION: ScopeDefinition<'commit-diff'> = {
  id: 'commit-diff',
  label: 'Commit Diff',
  description: 'Review context built from a single commit diff.',
};
