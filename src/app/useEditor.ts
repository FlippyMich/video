/**
 * Subscribe a component to a slice of editor state.
 *
 * The selector runs on every store change, and the component re-renders only if
 * the slice actually differs. Panels that don't care about the playhead
 * therefore don't re-render sixty times a second while the film plays.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { store, type EditorState } from './store';

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function useEditor<T>(selector: (state: EditorState) => T): T {
  const cache = useRef<{ value: T; has: boolean }>({ value: undefined as T, has: false });

  const getSnapshot = useCallback(() => {
    const next = selector(store.getState());
    if (cache.current.has && shallowEqual(cache.current.value, next)) {
      return cache.current.value;
    }
    cache.current = { value: next, has: true };
    return next;
    // The selector is expected to be stable for the component's lifetime, which
    // is how every call site here is written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
