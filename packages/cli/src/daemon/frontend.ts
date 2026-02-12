/**
 * Loads dashboard SPA HTML and serves frontend module assets.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH_CANDIDATES = [
  resolve(__dirname, 'frontend/index.html'),
  resolve(__dirname, '../src/daemon/frontend/index.html'),
];

const FRONTEND_ROOT_CANDIDATES = [
  resolve(__dirname, 'frontend'),
  resolve(__dirname, '../src/daemon/frontend'),
];

const ALLOWED_ASSET_EXTENSIONS = new Set(['.js', '.css']);

export interface FrontendAsset {
  contentType: string;
  body: string;
}

let cachedHtml: string | null = null;
let indexedAssets: Map<string, string> | null = null;
const assetBodyCache = new Map<string, string>();

function isAllowedAssetPath(relativePath: string): boolean {
  const fileName = basename(relativePath);
  if (fileName.includes('.test.')) {
    return false;
  }
  const lastDot = relativePath.lastIndexOf('.');
  if (lastDot < 0) return false;
  const ext = relativePath.slice(lastDot);
  return ALLOWED_ASSET_EXTENSIONS.has(ext);
}

function indexFrontendDir(
  absoluteDir: string,
  relativeDir: string,
  out: Map<string, string>,
): void {
  const entries = readdirSync(absoluteDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = relativeDir
      ? `${relativeDir}/${entry.name}`
      : entry.name;
    const absolutePath = resolve(absoluteDir, entry.name);

    if (entry.isDirectory()) {
      indexFrontendDir(absolutePath, relativePath, out);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!isAllowedAssetPath(relativePath)) {
      continue;
    }

    // First root wins (built assets preferred over source fallback).
    if (!out.has(relativePath)) {
      out.set(relativePath, absolutePath);
    }
  }
}

function getIndexedAssets(): Map<string, string> {
  if (indexedAssets) {
    return indexedAssets;
  }

  const indexed = new Map<string, string>();
  for (const root of FRONTEND_ROOT_CANDIDATES) {
    if (!existsSync(root)) {
      continue;
    }
    indexFrontendDir(root, '', indexed);
  }

  indexedAssets = indexed;
  return indexedAssets;
}

function toAssetName(pathname: string): string | null {
  if (!pathname.startsWith('/_dashboard/')) {
    return null;
  }

  const name = pathname.slice('/_dashboard/'.length);
  if (!name || name.startsWith('/') || name.includes('..')) {
    return null;
  }

  if (!isAllowedAssetPath(name)) {
    return null;
  }

  return name;
}

function assetContentType(assetName: string): string {
  return assetName.endsWith('.css')
    ? 'text/css; charset=utf-8'
    : 'text/javascript; charset=utf-8';
}

export function getDashboardHtml(): string {
  if (!cachedHtml) {
    const htmlPath = HTML_PATH_CANDIDATES.find((path) => existsSync(path));
    if (!htmlPath) {
      throw new Error(
        `Dashboard HTML not found. Tried: ${HTML_PATH_CANDIDATES.join(', ')}`,
      );
    }
    cachedHtml = readFileSync(htmlPath, 'utf-8');
  }
  return cachedHtml;
}

export function getFrontendAsset(pathname: string): FrontendAsset | null {
  const assetName = toAssetName(pathname);
  if (!assetName) {
    return null;
  }

  const assetPath = getIndexedAssets().get(assetName);
  if (!assetPath) {
    return null;
  }

  let body = assetBodyCache.get(assetName);
  if (!body) {
    body = readFileSync(assetPath, 'utf-8');
    assetBodyCache.set(assetName, body);
  }

  return {
    contentType: assetContentType(assetName),
    body,
  };
}
