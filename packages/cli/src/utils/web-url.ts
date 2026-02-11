export function formatHostForUrl(host: string): string {
  if (host.includes(':') && !host.startsWith('[') && !host.endsWith(']')) {
    return `[${host}]`;
  }
  return host;
}

export function toWebUrl(host: string, port: number): string {
  return `http://${formatHostForUrl(host)}:${port}`;
}
