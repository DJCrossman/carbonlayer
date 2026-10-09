// Shimmering placeholder block shown while data loads.
import './ui.css';

export function Skeleton({ width, height = 10 }: { width: number | string; height?: number }) {
  return <span className="gg-skeleton" style={{ width, height }} aria-hidden />;
}
