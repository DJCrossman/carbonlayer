import { describe, expect, it } from 'vitest';
import { moveSelection, type SectionRows } from './selection';

const sections: SectionRows[] = [
  { viewId: 'a', collapsed: false, prIds: ['1', '2'] },
  { viewId: 'b', collapsed: true, prIds: ['3'] },
  { viewId: 'c', collapsed: false, prIds: [] },
  { viewId: 'd', collapsed: false, prIds: ['4', '1'] },
];

describe('moveSelection', () => {
  it('starts at the first visible row when nothing is selected, in either direction', () => {
    expect(moveSelection(sections, null, 1)).toEqual({ viewId: 'a', prId: '1' });
    expect(moveSelection(sections, null, -1)).toEqual({ viewId: 'a', prId: '1' });
  });

  it('crosses section boundaries, skipping collapsed and empty sections', () => {
    expect(moveSelection(sections, { viewId: 'a', prId: '2' }, 1)).toEqual({ viewId: 'd', prId: '4' });
    expect(moveSelection(sections, { viewId: 'd', prId: '4' }, -1)).toEqual({ viewId: 'a', prId: '2' });
  });

  it('keeps the same PR in two sections apart', () => {
    expect(moveSelection(sections, { viewId: 'd', prId: '4' }, 1)).toEqual({ viewId: 'd', prId: '1' });
  });

  it('stays put at either end', () => {
    expect(moveSelection(sections, { viewId: 'a', prId: '1' }, -1)).toEqual({ viewId: 'a', prId: '1' });
    expect(moveSelection(sections, { viewId: 'd', prId: '1' }, 1)).toEqual({ viewId: 'd', prId: '1' });
  });

  it('moves a selection hidden by collapsing its section to the nearest visible row', () => {
    const firstCollapsed = sections.map((section) => (section.viewId === 'a' ? { ...section, collapsed: true } : section));
    expect(moveSelection(firstCollapsed, { viewId: 'a', prId: '1' }, 1)).toEqual({ viewId: 'd', prId: '4' });
    const lastCollapsed = sections.map((section) => (section.viewId === 'd' ? { ...section, collapsed: true } : section));
    expect(moveSelection(lastCollapsed, { viewId: 'd', prId: '4' }, 1)).toEqual({ viewId: 'a', prId: '2' });
  });

  it('restarts at the top when the selected row disappeared in a refresh', () => {
    expect(moveSelection(sections, { viewId: 'a', prId: 'gone' }, 1)).toEqual({ viewId: 'a', prId: '1' });
  });

  it('selects nothing when no row is visible', () => {
    const allCollapsed = sections.map((section) => ({ ...section, collapsed: true }));
    expect(moveSelection(allCollapsed, null, 1)).toBeNull();
    expect(moveSelection(allCollapsed, { viewId: 'a', prId: '1' }, 1)).toBeNull();
  });
});
