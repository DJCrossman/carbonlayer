// Importing views from a shared inbox link.
import type { View } from '../lib/model';

/**
 * The view list after importing `incoming`: `replace` swaps the whole list, `append` adds the incoming views after the
 * current ones. Any view whose id is already taken (by a kept view, or earlier in the link) gets a fresh id, so every
 * copy survives.
 */
export function importViews(current: View[], incoming: View[], mode: 'replace' | 'append'): View[] {
  const kept = mode === 'replace' ? [] : current;
  const taken = new Set(kept.map((view) => view.id));
  const added = incoming.map((view) => {
    const id = taken.has(view.id) ? crypto.randomUUID() : view.id;
    taken.add(id);
    return id === view.id ? view : { ...view, id };
  });
  return [...kept, ...added];
}
