// A GitHub label in its own colour, kept readable in light and dark themes (github.com's label maths, in ui.css).
import type { CSSProperties } from 'react';
import type { LabelSummary } from '../lib/model';
import './ui.css';

export function LabelChip({ label }: { label: LabelSummary }) {
  const hex = /^#?([0-9a-f]{6})$/i.exec(label.color)?.[1] ?? 'ededed';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  const chroma = max - min;
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (chroma > 0) {
    if (max === r / 255) hue = ((g - b) / 255 / chroma) % 6;
    else if (max === g / 255) hue = (b - r) / 255 / chroma + 2;
    else hue = (r - g) / 255 / chroma + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const style: CSSProperties & Record<`--label-${string}`, number> = {
    '--label-r': r,
    '--label-g': g,
    '--label-b': b,
    '--label-h': Math.round(hue),
    '--label-s': Math.round(saturation * 100),
    '--label-l': Math.round(lightness * 100),
  };
  return (
    <span className="gg-label-chip" style={style} title={label.name}>
      {label.name}
    </span>
  );
}
