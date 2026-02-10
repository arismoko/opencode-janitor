/**
 * React hook for scoped keymap dispatch.
 *
 * Uses ink's `useInput` to capture keystrokes and resolves them against
 * the active scoped keymaps. Calls the provided `onAction` handler with
 * the resolved action string.
 */

import { useInput } from 'ink';
import { useCallback } from 'react';
import type { ScopedKeymap } from '../types';
import { resolveKeyAction } from './keymap';

export type ActionHandler = (action: string) => void;

/**
 * Translate an ink `useInput` key event into a canonical key name
 * matching the names used in keymap binding definitions.
 */
function canonicalKey(
  input: string,
  key: {
    upArrow?: boolean;
    downArrow?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
    return?: boolean;
    escape?: boolean;
    tab?: boolean;
    backspace?: boolean;
    delete?: boolean;
  },
): string {
  if (key.upArrow) return 'up';
  if (key.downArrow) return 'down';
  if (key.leftArrow) return 'left';
  if (key.rightArrow) return 'right';
  if (key.return) return 'return';
  if (key.escape) return 'escape';
  if (key.tab) return 'tab';
  if (key.backspace) return 'backspace';
  if (key.delete) return 'delete';
  return input;
}

/**
 * Hook that listens for keyboard input and dispatches matching actions
 * from the provided scoped keymaps.
 *
 * @param scopes - Ordered list of keymaps to search (first match wins).
 * @param onAction - Called with the matched action string.
 * @param active - Set to false to temporarily disable input handling.
 */
export function useScopedKeymap(
  scopes: readonly ScopedKeymap[],
  onAction: ActionHandler,
  active = true,
): void {
  const handler = useCallback(
    (
      input: string,
      key: {
        upArrow?: boolean;
        downArrow?: boolean;
        leftArrow?: boolean;
        rightArrow?: boolean;
        return?: boolean;
        escape?: boolean;
        tab?: boolean;
        backspace?: boolean;
        delete?: boolean;
      },
    ) => {
      const name = canonicalKey(input, key);
      const action = resolveKeyAction(name, scopes);
      if (action !== null) {
        onAction(action);
      }
    },
    [scopes, onAction],
  );

  useInput(handler, { isActive: active });
}
