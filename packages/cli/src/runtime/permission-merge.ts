import type {
  PermissionDecision,
  PermissionExtensions,
  PermissionRule,
} from '@opencode-janitor/shared';

export type PermissionPatternMap = Record<string, PermissionDecision>;
export type PermissionPolicy = Record<string, PermissionRule>;

function isPatternMap(value: PermissionRule): value is PermissionPatternMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeRule(
  current: PermissionRule,
  incoming: PermissionRule,
): PermissionRule {
  if (isPatternMap(current) && isPatternMap(incoming)) {
    return {
      ...current,
      ...incoming,
    };
  }

  return incoming;
}

function applyExtensions(
  target: PermissionPolicy,
  extension?: PermissionExtensions,
): void {
  if (!extension) {
    return;
  }

  for (const key of Object.keys(extension)) {
    const incoming = extension[key];
    const current = target[key];
    if (current === undefined) {
      target[key] = incoming;
      continue;
    }

    target[key] = mergeRule(current, incoming);
  }
}

export function mergePermissionExtensions(
  base: PermissionPolicy,
  globalExt?: PermissionExtensions,
  agentExt?: PermissionExtensions,
): PermissionPolicy {
  const merged: PermissionPolicy = { ...base };
  applyExtensions(merged, globalExt);
  applyExtensions(merged, agentExt);
  return merged;
}
