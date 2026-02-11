/**
 * Loads the dashboard SPA HTML from the co-located file.
 * Caches the result in memory after the first read.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH_CANDIDATES = [
  resolve(__dirname, 'dashboard.html'),
  resolve(__dirname, '../src/daemon/dashboard.html'),
];

let cached: string | null = null;

export function getDashboardHtml(): string {
  if (!cached) {
    const htmlPath = HTML_PATH_CANDIDATES.find((path) => existsSync(path));
    if (!htmlPath) {
      throw new Error(
        `Dashboard HTML not found. Tried: ${HTML_PATH_CANDIDATES.join(', ')}`,
      );
    }
    cached = readFileSync(htmlPath, 'utf-8');
  }
  return cached;
}
