import { describe, expect, it } from 'bun:test';
import { mergePermissionExtensions } from './permission-merge';

describe('mergePermissionExtensions', () => {
  it('returns base permissions unchanged when no extensions are provided', () => {
    const base = {
      '*': 'deny',
      read: 'allow',
      bash: 'deny',
    } as const;

    expect(mergePermissionExtensions(base)).toEqual(base);
  });

  it('applies global extensions', () => {
    const merged = mergePermissionExtensions(
      {
        '*': 'deny',
        read: 'allow',
      },
      {
        'context7_*': {
          '*': 'ask',
        },
        webfetch: 'ask',
      },
    );

    expect(merged['context7_*']).toEqual({ '*': 'ask' });
    expect(merged.webfetch).toBe('ask');
  });

  it('lets per-agent extensions override global extensions', () => {
    const merged = mergePermissionExtensions(
      {
        '*': 'deny',
      },
      {
        'context7_*': 'ask',
      },
      {
        'context7_*': 'allow',
      },
    );

    expect(merged['context7_*']).toBe('allow');
  });

  it('merges object rules shallowly with later keys winning', () => {
    const merged = mergePermissionExtensions(
      {
        bash: {
          '*': 'deny',
          'git *': 'ask',
        },
      },
      {
        bash: {
          '*': 'ask',
          'git status*': 'allow',
        },
      },
      {
        bash: {
          'git *': 'allow',
          'git push *': 'deny',
        },
      },
    );

    expect(merged.bash).toEqual({
      '*': 'ask',
      'git *': 'allow',
      'git status*': 'allow',
      'git push *': 'deny',
    });
  });

  it('replaces whole rule when scalar and object conflict', () => {
    const first = mergePermissionExtensions(
      { bash: 'deny' },
      { bash: { '*': 'ask', 'git *': 'allow' } },
    );
    expect(first.bash).toEqual({ '*': 'ask', 'git *': 'allow' });

    const second = mergePermissionExtensions(
      { bash: { '*': 'ask', 'git *': 'allow' } },
      { bash: 'deny' },
    );
    expect(second.bash).toBe('deny');
  });

  it('supports MCP-prefixed keys and preserves deterministic key order', () => {
    const merged = mergePermissionExtensions(
      {
        '*': 'deny',
        read: 'allow',
      },
      {
        'context7_*': 'ask',
      },
      {
        'gh_grep_*': 'allow',
      },
    );

    expect(Object.keys(merged)).toEqual([
      '*',
      'read',
      'context7_*',
      'gh_grep_*',
    ]);
    expect(merged['context7_*']).toBe('ask');
    expect(merged['gh_grep_*']).toBe('allow');
  });
});
