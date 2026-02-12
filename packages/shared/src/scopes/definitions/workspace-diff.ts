import type { ScopeDefinition } from '../types';

export const WORKSPACE_DIFF_SCOPE_DEFINITION: ScopeDefinition<'workspace-diff'> =
  {
    id: 'workspace-diff',
    label: 'Workspace Diff',
    description: 'Review context built from current workspace changes.',
  };
