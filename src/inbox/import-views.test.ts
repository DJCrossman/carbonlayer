import { describe, expect, it } from 'vitest';
import type { View } from '../lib/model';
import { importViews } from './import-views';

const current: View[] = [
  { id: 'needs-review', name: 'Needs your review', query: 'is:pr review-requested:@me', collapsed: true },
  { id: 'mine', name: 'Mine', query: 'is:pr author:@me' },
];
const incoming: View[] = [
  { id: 'needs-review', name: 'Team review', query: 'is:pr team-review-requested:acme/web' },
  { id: 'hotfixes', name: 'Hotfixes', query: 'is:pr label:hotfix' },
];

describe('importViews', () => {
  it('replaces the whole list', () => {
    expect(importViews(current, incoming, 'replace')).toEqual(incoming);
  });

  it('appends after the current views and gives a clashing id a fresh one', () => {
    const result = importViews(current, incoming, 'append');
    expect(result.slice(0, 2)).toEqual(current);
    expect(result[2]).toMatchObject({ name: 'Team review', query: 'is:pr team-review-requested:acme/web' });
    expect(result[2]?.id).not.toBe('needs-review');
    expect(result[3]).toEqual(incoming[1]);
    expect(new Set(result.map((view) => view.id)).size).toBe(4);
  });

  it('replaces a view of the same name, whatever its case, in place and under its own id', () => {
    const again: View[] = [
      { id: 'from-link', name: 'needs your REVIEW ', query: 'is:pr review-requested:@me -author:@me' },
      { id: 'hotfixes', name: 'Hotfixes', query: 'is:pr label:hotfix' },
    ];
    expect(importViews(current, again, 'append')).toEqual([
      { id: 'needs-review', name: 'needs your REVIEW ', query: 'is:pr review-requested:@me -author:@me' },
      current[1],
      again[1],
    ]);
  });

  it.each(['append', 'replace'] as const)('keeps ids unique when the link itself repeats one (%s)', (mode) => {
    const repeated = [incoming[1]!, { ...incoming[1]!, name: 'Hotfixes again' }];
    const result = importViews([], repeated, mode);
    expect(result[0]?.id).toBe('hotfixes');
    expect(result[1]?.id).not.toBe('hotfixes');
  });
});
