// A keyboard key cap, e.g. <Kbd>j</Kbd> or <Kbd>⌘</Kbd><Kbd>↵</Kbd>.
import type { ReactNode } from 'react';
import './ui.css';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="gg-kbd">{children}</kbd>;
}
