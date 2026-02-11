import type { ScopeDefinition } from '../types';

export const REPO_SCOPE_DEFINITION: ScopeDefinition<'repo'> = {
  id: 'repo',
  label: 'Repository',
  description: 'Repo-wide review context without a specific diff payload.',
};
