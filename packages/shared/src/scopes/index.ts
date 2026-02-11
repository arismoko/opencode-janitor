import { COMMIT_DIFF_SCOPE_DEFINITION } from './definitions/commit-diff';
import { PR_SCOPE_DEFINITION } from './definitions/pr';
import { REPO_SCOPE_DEFINITION } from './definitions/repo';
import { WORKSPACE_DIFF_SCOPE_DEFINITION } from './definitions/workspace-diff';

export { COMMIT_DIFF_SCOPE_DEFINITION } from './definitions/commit-diff';
export { PR_SCOPE_DEFINITION } from './definitions/pr';
export { REPO_SCOPE_DEFINITION } from './definitions/repo';
export { WORKSPACE_DIFF_SCOPE_DEFINITION } from './definitions/workspace-diff';
export type { ScopeCliOption, ScopeDefinition } from './types';

export const SCOPES = {
  'commit-diff': COMMIT_DIFF_SCOPE_DEFINITION,
  'workspace-diff': WORKSPACE_DIFF_SCOPE_DEFINITION,
  repo: REPO_SCOPE_DEFINITION,
  pr: PR_SCOPE_DEFINITION,
} as const;

export type ScopeId = keyof typeof SCOPES;

export const SCOPE_IDS: readonly ScopeId[] = Object.keys(SCOPES) as ScopeId[];

export function isScopeId(value: string): value is ScopeId {
  return value in SCOPES;
}
