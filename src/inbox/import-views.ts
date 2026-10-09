// Importing views from a shared inbox link.
import type { View } from '../lib/model';

/**
 * The view list after importing `incoming`: `replace` swaps the whole list, `append` adds the incoming views after the
 * current ones and gives any view whose id is already taken a fresh id, so both copies survive.
 */
export function importViews(current: View[], incoming: View[], mode: 'replace' | 'append'): View[] {
  if (mode === 'replace') return incoming;
  const taken = new Set(current.map((view) => view.id));
  const added = incoming.map((view) => {
    const id = taken.has(view.id) ? crypto.randomUUID() : view.id;
    taken.add(id);
    return id === view.id ? view : { ...view, id };
  });
  return [...current, ...added];
}
