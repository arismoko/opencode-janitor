/**
 * Loads the dashboard SPA HTML from the frontend source/build folder.
 * Caches the result in memory after the first read.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH_CANDIDATES = [
  resolve(__dirname, 'frontend/index.html'),
  resolve(__dirname, '../src/daemon/frontend/index.html'),
];

const FRONTEND_ASSET_NAMES = [
  'app.js',
  'api.js',
  'components/dashboard-header.js',
  'components/flash-toast.js',
  'components/manual-review-modal.js',
  'components/repo-picker.js',
  'constants.js',
  'helpers.js',
  'selectors/dashboard-selectors.js',
  'state/use-dashboard-data.js',
  'state/use-flash.js',
  'state/use-report-detail.js',
  'state/use-report-selection.js',
  'state/use-repo-selection.js',
  'styles.css',
  'views/activity-view.js',
  'views/reports/report-detail.js',
  'views/reports/reports-list.js',
  'views/reports/reports-meta.js',
  'views/reports-view.js',
] as const;

type FrontendAssetName = (typeof FRONTEND_ASSET_NAMES)[number];
const FRONTEND_ASSET_SET = new Set<string>(FRONTEND_ASSET_NAMES);

export interface FrontendAsset {
  contentType: string;
  body: string;
}

let cached: string | null = null;
const assetCache = new Map<FrontendAssetName, string>();

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

function toAssetName(pathname: string): FrontendAssetName | null {
  if (!pathname.startsWith('/_dashboard/')) {
    return null;
  }

  const name = pathname.slice('/_dashboard/'.length);
  if (name.includes('..') || name.startsWith('/')) {
    return null;
  }

  if (FRONTEND_ASSET_SET.has(name)) {
    return name as FrontendAssetName;
  }
  return null;
}

function resolveAssetPathCandidates(assetName: FrontendAssetName): string[] {
  return [
    resolve(__dirname, `frontend/${assetName}`),
    resolve(__dirname, `../src/daemon/frontend/${assetName}`),
  ];
}

function assetContentType(assetName: FrontendAssetName): string {
  return assetName.endsWith('.css')
    ? 'text/css; charset=utf-8'
    : 'text/javascript; charset=utf-8';
}

export function getFrontendAsset(pathname: string): FrontendAsset | null {
  const assetName = toAssetName(pathname);
  if (!assetName) {
    return null;
  }

  let body = assetCache.get(assetName);
  if (!body) {
    const pathCandidates = resolveAssetPathCandidates(assetName);
    const assetPath = pathCandidates.find((path) => existsSync(path));
    if (!assetPath) {
      throw new Error(
        `Frontend asset not found (${assetName}). Tried: ${pathCandidates.join(', ')}`,
      );
    }
    body = readFileSync(assetPath, 'utf-8');
    assetCache.set(assetName, body);
  }

  return {
    contentType: assetContentType(assetName),
    body,
  };
}
