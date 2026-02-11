import { describe, expect, it } from 'bun:test';
import { formatHostForUrl, toWebUrl } from './web-url';

describe('web URL formatting', () => {
  it('keeps IPv4 host unchanged', () => {
    expect(formatHostForUrl('127.0.0.1')).toBe('127.0.0.1');
    expect(toWebUrl('127.0.0.1', 7700)).toBe('http://127.0.0.1:7700');
  });

  it('keeps hostname unchanged', () => {
    expect(formatHostForUrl('localhost')).toBe('localhost');
    expect(toWebUrl('localhost', 7700)).toBe('http://localhost:7700');
  });

  it('brackets raw IPv6 literals', () => {
    expect(formatHostForUrl('::1')).toBe('[::1]');
    expect(toWebUrl('::1', 7700)).toBe('http://[::1]:7700');
  });

  it('does not double-bracket already bracketed IPv6 literals', () => {
    expect(formatHostForUrl('[::1]')).toBe('[::1]');
    expect(toWebUrl('[::1]', 7700)).toBe('http://[::1]:7700');
  });
});
