/**
 * Extract the head SHA from a workspace key, or return the key unchanged.
 *
 * If key matches `workspace:<branch>:<sha>`, returns the sha portion.
 * Otherwise returns the key as-is.
 */
export function extractWorkspaceHeadFromKey(key: string): string {
  if (key.startsWith('workspace:') && key.split(':').length >= 3) {
    return key.split(':')[2];
  }
  return key;
}
