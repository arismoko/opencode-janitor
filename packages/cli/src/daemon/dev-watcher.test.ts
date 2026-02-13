import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createDevWatcher,
  type DevWatcher,
  isDevMode,
  isRendererSourceFilename,
} from './dev-watcher';
import {
  getDashboardHtml,
  getFrontendAsset,
  invalidateFrontendCaches,
} from './frontend';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock ReadableStreamDefaultController that records enqueued chunks.
 */
function mockController(): {
  controller: ReadableStreamDefaultController<Uint8Array>;
  chunks: Uint8Array[];
} {
  const chunks: Uint8Array[] = [];
  const controller = {
    enqueue(chunk: Uint8Array) {
      chunks.push(chunk);
    },
    close() {},
    error() {},
    desiredSize: 1,
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  return { controller, chunks };
}

function decodeChunks(chunks: Uint8Array[]): string[] {
  const decoder = new TextDecoder();
  return chunks.map((c) => decoder.decode(c));
}

/**
 * Wait for the debounce timer plus a safety margin.
 */
function waitDebounce(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// isDevMode()
// ---------------------------------------------------------------------------

describe('isDevMode()', () => {
  const originalEnv = process.env.JANITOR_DEV;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.JANITOR_DEV;
    } else {
      process.env.JANITOR_DEV = originalEnv;
    }
  });

  it('returns false when JANITOR_DEV is unset', () => {
    delete process.env.JANITOR_DEV;
    expect(isDevMode()).toBe(false);
  });

  it('returns true when JANITOR_DEV is "1"', () => {
    process.env.JANITOR_DEV = '1';
    expect(isDevMode()).toBe(true);
  });

  it('returns true when JANITOR_DEV is "true"', () => {
    process.env.JANITOR_DEV = 'true';
    expect(isDevMode()).toBe(true);
  });

  it('returns false for other truthy-looking values', () => {
    process.env.JANITOR_DEV = 'yes';
    expect(isDevMode()).toBe(false);

    process.env.JANITOR_DEV = '0';
    expect(isDevMode()).toBe(false);

    process.env.JANITOR_DEV = '';
    expect(isDevMode()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isRendererSourceFilename()
// ---------------------------------------------------------------------------

describe('isRendererSourceFilename()', () => {
  it('matches forward-slash renderer paths (JS)', () => {
    expect(
      isRendererSourceFilename('myagent/renderers/architecture-v1.js'),
    ).toBe(true);
  });

  it('matches forward-slash renderer paths (CSS)', () => {
    expect(
      isRendererSourceFilename('myagent/renderers/architecture-v1.css'),
    ).toBe(true);
  });

  it('matches backslash renderer paths', () => {
    expect(
      isRendererSourceFilename('myagent\\renderers\\architecture-v1.js'),
    ).toBe(true);
  });

  it('matches backslash renderer paths (CSS)', () => {
    expect(
      isRendererSourceFilename('myagent\\renderers\\architecture-v1.css'),
    ).toBe(true);
  });

  it('matches deeply nested renderer paths', () => {
    expect(isRendererSourceFilename('agents/myagent/renderers/foo-v2.js')).toBe(
      true,
    );
    expect(
      isRendererSourceFilename('agents\\myagent\\renderers\\foo-v2.js'),
    ).toBe(true);
    expect(
      isRendererSourceFilename('agents/myagent/renderers/foo-v2.css'),
    ).toBe(true);
  });

  it('rejects non-renderer paths', () => {
    expect(isRendererSourceFilename('myagent/definition.ts')).toBe(false);
    expect(
      isRendererSourceFilename('myagent/something/architecture-v1.js'),
    ).toBe(false);
    expect(isRendererSourceFilename('renderers-extra/architecture-v1.js')).toBe(
      false,
    );
  });

  it('rejects non-js/css files in renderer paths', () => {
    expect(
      isRendererSourceFilename('myagent/renderers/architecture-v1.ts'),
    ).toBe(false);
    expect(isRendererSourceFilename('myagent/renderers/README.md')).toBe(false);
    expect(isRendererSourceFilename('myagent/renderers/data.json')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// invalidateFrontendCaches()
// ---------------------------------------------------------------------------

describe('invalidateFrontendCaches()', () => {
  it('causes getDashboardHtml to re-read from disk', () => {
    // First call populates the cache.
    const first = getDashboardHtml();
    expect(first).toContain('<div id="app">');

    // Invalidate and call again — should still work (re-reads from disk).
    invalidateFrontendCaches();
    const second = getDashboardHtml();
    expect(second).toContain('<div id="app">');
    expect(second).toBe(first);
  });

  it('causes getFrontendAsset to re-index and re-read from disk', () => {
    // First call populates both index and body cache.
    const first = getFrontendAsset('/_dashboard/app.js');
    expect(first).toBeDefined();

    // Invalidate and call again.
    invalidateFrontendCaches();
    const second = getFrontendAsset('/_dashboard/app.js');
    expect(second).toBeDefined();
    expect(second?.body).toBe(first?.body);
  });

  it('serves the generated CSS manifest as a frontend asset', () => {
    const asset = getFrontendAsset(
      '/_dashboard/views/reports/finding-enrichments/renderers/agents/agent-enrichments.generated.css',
    );
    expect(asset).toBeDefined();
    expect(asset?.contentType).toBe('text/css; charset=utf-8');
    expect(asset?.body).toContain('@import');
  });
});

// ---------------------------------------------------------------------------
// DevWatcher client management and SSE broadcast
// ---------------------------------------------------------------------------

describe('DevWatcher', () => {
  let watcher: DevWatcher;

  beforeEach(() => {
    watcher = createDevWatcher();
  });

  afterEach(() => {
    watcher.stop();
  });

  it('accepts and removes SSE clients', () => {
    const { controller } = mockController();
    watcher.addClient(controller);
    // Should not throw.
    watcher.removeClient(controller);
    // Removing a non-existent client should be a no-op.
    watcher.removeClient(controller);
  });

  it('broadcasts reload event to connected clients on frontend file change', async () => {
    const { controller, chunks } = mockController();
    watcher.addClient(controller);

    // Touch a frontend file to trigger the watcher.
    const touchPath = resolve(
      import.meta.dirname,
      'frontend/__dev-test-touch.js',
    );
    writeFileSync(touchPath, '// dev-watcher test');

    await waitDebounce();

    // Clean up the touch file.
    try {
      require('node:fs').unlinkSync(touchPath);
    } catch {
      // Ignore cleanup errors.
    }

    // Should have received at least one SSE reload chunk.
    expect(chunks.length).toBeGreaterThanOrEqual(1);

    const decoded = decodeChunks(chunks);
    const reloadEvents = decoded.filter((d) => d.includes('event: reload'));
    expect(reloadEvents.length).toBeGreaterThanOrEqual(1);

    // Verify SSE format: "event: reload\ndata: {"ts":...}\n\n"
    const event = reloadEvents[0];
    expect(event).toMatch(/^event: reload\ndata: \{.*"ts":\d+.*\}\n\n$/);
  });

  it('debounces rapid file changes into a single broadcast', async () => {
    const { controller, chunks } = mockController();
    watcher.addClient(controller);

    // Touch a file multiple times in rapid succession.
    const touchPath = resolve(
      import.meta.dirname,
      'frontend/__dev-test-debounce.js',
    );
    for (let i = 0; i < 5; i++) {
      writeFileSync(touchPath, `// debounce test ${i}`);
    }

    await waitDebounce();

    try {
      require('node:fs').unlinkSync(touchPath);
    } catch {
      // Ignore cleanup.
    }

    // Due to debounce, should have at most 1-2 reload events (not 5).
    const decoded = decodeChunks(chunks);
    const reloadEvents = decoded.filter((d) => d.includes('event: reload'));
    expect(reloadEvents.length).toBeLessThanOrEqual(2);
    expect(reloadEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('stop prevents further broadcasts', async () => {
    const { controller, chunks } = mockController();
    watcher.addClient(controller);

    watcher.stop();

    // Touch a file after stop.
    const touchPath = resolve(
      import.meta.dirname,
      'frontend/__dev-test-stopped.js',
    );
    writeFileSync(touchPath, '// after stop');

    await waitDebounce();

    try {
      require('node:fs').unlinkSync(touchPath);
    } catch {
      // Ignore cleanup.
    }

    // No events should have been broadcast.
    expect(chunks.length).toBe(0);
  });

  it('ignores .test.js frontend files', async () => {
    // Wait for any pending FS events from prior tests to settle.
    await waitDebounce();

    const { controller, chunks } = mockController();
    watcher.addClient(controller);

    // Touch a .test.js file — should be ignored.
    const touchPath = resolve(
      import.meta.dirname,
      'frontend/__dev-watcher-ignore.test.js',
    );
    writeFileSync(touchPath, '// test file');

    await waitDebounce();

    try {
      require('node:fs').unlinkSync(touchPath);
    } catch {
      // Ignore cleanup.
    }

    // Should NOT have received any reload events from this change alone.
    // (Note: other unrelated FS events on the dir may still trigger, so we
    // check that no reload was caused by our specific write.)
    expect(chunks.length).toBe(0);
  });

  it('handles client controller that throws on enqueue', async () => {
    // Wait for any pending FS events from prior tests to settle.
    await waitDebounce();

    // Simulate a disconnected client whose controller throws.
    const throwingController = {
      enqueue() {
        throw new Error('stream closed');
      },
      close() {},
      error() {},
      desiredSize: 1,
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    const { controller: goodController, chunks: goodChunks } = mockController();

    watcher.addClient(throwingController);
    watcher.addClient(goodController);

    // Trigger a change.
    const touchPath = resolve(
      import.meta.dirname,
      'frontend/__dev-test-throw.js',
    );
    writeFileSync(touchPath, '// throw test');

    await waitDebounce();

    try {
      require('node:fs').unlinkSync(touchPath);
    } catch {
      // Ignore cleanup.
    }

    // Good client should still receive the event despite the bad client throwing.
    expect(goodChunks.length).toBeGreaterThanOrEqual(1);
  });
});
