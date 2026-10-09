// Keyboard selection in the inbox. A row is identified by its section and PR, because one PR can appear in several sections.

/**
 * The row j (`step` 1) or k (`step` -1) lands on: the neighbouring row across expanded sections, skipping collapsed
 * ones and staying put at either end. With no (or a vanished) selection it starts at the first visible row. A selection
 * hidden by collapsing its section moves on to the nearest visible row in the direction of travel, or back if none.
 */
export function moveSelection(sections: SectionRows[], current: SelectedRow | null, step: 1 | -1): SelectedRow | null {
  const rows = sections.flatMap((section) => section.prIds.map((prId) => ({ viewId: section.viewId, prId, visible: !section.collapsed })));
  const index = current ? rows.findIndex((row) => row.viewId === current.viewId && row.prId === current.prId) : -1;
  if (index === -1) {
    const first = rows.find((row) => row.visible);
    return first ? { viewId: first.viewId, prId: first.prId } : null;
  }
  const nearestVisible = (direction: 1 | -1) => {
    for (let i = index + direction; i >= 0 && i < rows.length; i += direction) {
      const row = rows[i];
      if (row?.visible) return { viewId: row.viewId, prId: row.prId };
    }
    return null;
  };
  const ahead = nearestVisible(step);
  if (ahead) return ahead;
  if (rows[index]?.visible) return current;
  return nearestVisible(step === 1 ? -1 : 1);
}

export interface SelectedRow {
  viewId: string;
  prId: string;
}

export interface SectionRows {
  viewId: string;
  collapsed: boolean;
  prIds: string[];
}
