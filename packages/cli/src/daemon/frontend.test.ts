import { describe, expect, it } from 'bun:test';
import { getDashboardHtml, getFrontendAsset } from './frontend';

describe('frontend asset loading', () => {
  it('loads dashboard html shell', () => {
    const html = getDashboardHtml();
    expect(html).toContain('<div id="app"></div>');
    expect(html).toContain('/_dashboard/styles.css');
    expect(html).toContain('/_dashboard/app.js');
  });

  it('loads app js asset', () => {
    const asset = getFrontendAsset('/_dashboard/app.js');
    expect(asset).toBeDefined();
    expect(asset?.contentType).toBe('text/javascript; charset=utf-8');
    expect(asset?.body).toContain(
      "import htm from 'https://esm.sh/htm@3.1.1';",
    );
  });

  it('loads stylesheet asset', () => {
    const asset = getFrontendAsset('/_dashboard/styles.css');
    expect(asset).toBeDefined();
    expect(asset?.contentType).toBe('text/css; charset=utf-8');
    expect(asset?.body).toContain(':root');
  });

  it('loads nested frontend module assets', () => {
    const asset = getFrontendAsset('/_dashboard/views/reports-view.js');
    expect(asset).toBeDefined();
    expect(asset?.contentType).toBe('text/javascript; charset=utf-8');
    expect(asset?.body).toContain('export function renderReportsView');
  });

  it('loads frontend state module assets', () => {
    const asset = getFrontendAsset('/_dashboard/state/use-dashboard-data.js');
    expect(asset).toBeDefined();
    expect(asset?.contentType).toBe('text/javascript; charset=utf-8');
    expect(asset?.body).toContain('export function useDashboardData');
  });

  it('loads repo selection state module assets', () => {
    const asset = getFrontendAsset('/_dashboard/state/use-repo-selection.js');
    expect(asset).toBeDefined();
    expect(asset?.contentType).toBe('text/javascript; charset=utf-8');
    expect(asset?.body).toContain('export function useRepoSelection');
  });

  it('loads extracted state module assets', () => {
    const capabilities = getFrontendAsset(
      '/_dashboard/state/use-capabilities.js',
    );
    const reportDetail = getFrontendAsset(
      '/_dashboard/state/use-report-detail.js',
    );
    const reportSelection = getFrontendAsset(
      '/_dashboard/state/use-report-selection.js',
    );
    const flash = getFrontendAsset('/_dashboard/state/use-flash.js');
    expect(capabilities).toBeDefined();
    expect(capabilities?.body).toContain('export function useCapabilities');
    expect(reportDetail).toBeDefined();
    expect(reportDetail?.body).toContain('export function useReportDetail');
    expect(reportSelection).toBeDefined();
    expect(reportSelection?.body).toContain(
      'export function useReportSelection',
    );
    expect(flash).toBeDefined();
    expect(flash?.body).toContain('export function useFlash');
  });

  it('loads extracted component and selector assets', () => {
    const capabilityModal = getFrontendAsset(
      '/_dashboard/components/capability-driven-manual-modal.js',
    );
    const header = getFrontendAsset(
      '/_dashboard/components/dashboard-header.js',
    );
    const modal = getFrontendAsset(
      '/_dashboard/components/manual-review-modal.js',
    );
    const selectors = getFrontendAsset(
      '/_dashboard/selectors/dashboard-selectors.js',
    );
    expect(capabilityModal).toBeDefined();
    expect(capabilityModal?.body).toContain(
      'export function CapabilityDrivenManualModal',
    );
    expect(header).toBeDefined();
    expect(header?.body).toContain('export function renderDashboardHeader');
    expect(modal).toBeDefined();
    expect(modal?.body).toContain('export function renderManualReviewModal');
    expect(selectors).toBeDefined();
    expect(selectors?.body).toContain('export function selectFilteredActivity');
  });

  it('loads ui constants asset', () => {
    const constants = getFrontendAsset('/_dashboard/ui-constants.js');
    expect(constants).toBeDefined();
    expect(constants?.body).toContain('export const BADGE');
  });

  it('loads nested reports subview module assets', () => {
    const meta = getFrontendAsset('/_dashboard/views/reports/reports-meta.js');
    const list = getFrontendAsset('/_dashboard/views/reports/reports-list.js');
    const detail = getFrontendAsset(
      '/_dashboard/views/reports/report-detail.js',
    );
    expect(meta).toBeDefined();
    expect(meta?.body).toContain('export function renderReportsMeta');
    expect(list).toBeDefined();
    expect(list?.body).toContain('export function renderReportsList');
    expect(detail).toBeDefined();
    expect(detail?.body).toContain('export function renderReportDetail');
  });

  it('returns null for unknown frontend asset path', () => {
    expect(getFrontendAsset('/_dashboard/unknown.css')).toBeNull();
    expect(getFrontendAsset('/_dashboard/../app.js')).toBeNull();
    expect(getFrontendAsset('/v1/events')).toBeNull();
  });
});
