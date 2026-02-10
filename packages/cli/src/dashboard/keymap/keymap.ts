/**
 * Declarative keymap definitions.
 *
 * Each scope contains an ordered list of key bindings.  The scope determines
 * which bindings are active (e.g. "global" is always active, "list" only
 * when a list pane is focused).
 */

import type { KeyBinding, ScopedKeymap } from '../types';

// ---------------------------------------------------------------------------
// Binding factory
// ---------------------------------------------------------------------------

function bind(key: string, label: string, action: string): KeyBinding {
  return { key, label, action };
}

// ---------------------------------------------------------------------------
// Scoped keymaps
// ---------------------------------------------------------------------------

export const GLOBAL_KEYMAP: ScopedKeymap = {
  scope: 'global',
  bindings: [
    bind('1', 'Reports', 'view:reports'),
    bind('2', 'Repos', 'view:repos'),
    bind('3', 'Activity', 'view:activity'),
    bind('R', 'Run agent…', 'review:trigger'),
    bind('D', 'Delete report', 'report:delete'),
    bind('y', 'Copy report', 'report:copy'),
    bind('f', 'Cycle filter', 'activity:filter_next'),
    bind('t', 'Toggle view', 'detail:toggle_mode'),
    bind('p', 'Pause stream', 'stream:pause'),
    bind('q', 'Quit', 'app:quit'),
    bind('r', 'Refresh', 'app:refresh'),
  ],
};

export const LIST_KEYMAP: ScopedKeymap = {
  scope: 'list',
  bindings: [
    bind('g', 'Top', 'cursor:top'),
    bind('G', 'Bottom', 'cursor:bottom'),
    bind('up', 'Up', 'cursor:up'),
    bind('down', 'Down', 'cursor:down'),
    bind('l', 'Open', 'cursor:open'),
    bind('return', 'Open', 'cursor:open'),
    bind('k', 'Up', 'cursor:up'),
    bind('j', 'Down', 'cursor:down'),
  ],
};

export const DETAIL_KEYMAP: ScopedKeymap = {
  scope: 'detail',
  bindings: [
    bind('escape', 'Back', 'detail:close'),
    bind('h', 'Back', 'detail:close'),
    bind('up', 'Scroll up', 'cursor:up'),
    bind('down', 'Scroll down', 'cursor:down'),
    bind('k', 'Scroll up', 'cursor:up'),
    bind('j', 'Scroll down', 'cursor:down'),
  ],
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ALL_KEYMAPS: readonly ScopedKeymap[] = [
  GLOBAL_KEYMAP,
  LIST_KEYMAP,
  DETAIL_KEYMAP,
];

/** Look up the first matching action for a key across the given scopes. */
export function resolveKeyAction(
  key: string,
  scopes: readonly ScopedKeymap[],
): string | null {
  for (const keymap of scopes) {
    for (const binding of keymap.bindings) {
      if (binding.key === key) {
        return binding.action;
      }
    }
  }
  return null;
}

/** Collect all bindings for a scope for display in help / status bar. */
export function bindingsForScope(scope: string): readonly KeyBinding[] {
  const keymap = ALL_KEYMAPS.find((km) => km.scope === scope);
  return keymap?.bindings ?? [];
}
