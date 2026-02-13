import { describe, expect, it } from 'bun:test';
import { buildDevReloadScript } from './web';

describe('buildDevReloadScript()', () => {
  it('creates an EventSource for /_dev/live-reload', () => {
    const script = buildDevReloadScript();
    expect(script).toContain('new EventSource("/_dev/live-reload")');
  });

  it('listens for reload events and triggers page refresh', () => {
    const script = buildDevReloadScript();
    expect(script).toContain('addEventListener("reload"');
    expect(script).toContain('window.location.reload()');
  });

  it('does NOT close EventSource on error (allows auto-reconnect)', () => {
    const script = buildDevReloadScript();
    expect(script).not.toContain('es.close()');
    expect(script).not.toContain('.close()');
    expect(script).not.toContain('onerror');
  });
});
