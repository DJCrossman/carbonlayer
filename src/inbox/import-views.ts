// Importing views from a shared inbox link.
import type { View } from '../lib/model';

/**
 * The view list after importing `incoming`: `replace` swaps the whole list, `append` adds the incoming views after the
 * current ones, except that an incoming view named like one already there (case aside) takes that view's place and keeps
 * its id, so importing the same sections twice updates them instead of listing them twice. Any other view whose id is
 * already taken (by a kept view, or earlier in the link) gets a fresh id, so every copy survives.
 */
export function importViews(current: View[], incoming: View[], mode: 'replace' | 'append'): View[] {
  const views = mode === 'replace' ? [] : [...current];
  for (const view of incoming) {
    const sameName = mode === 'append' ? views.findIndex((kept) => kept.name.trim().toLowerCase() === view.name.trim().toLowerCase()) : -1;
    if (sameName >= 0) {
      views[sameName] = { ...view, id: views[sameName]!.id };
      continue;
    }
    views.push(views.some((kept) => kept.id === view.id) ? { ...view, id: crypto.randomUUID() } : view);
  }
  return views;
}
