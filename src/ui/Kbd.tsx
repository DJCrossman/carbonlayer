// A keyboard key cap, e.g. <Kbd>⌘</Kbd><Kbd>↵</Kbd>, or one for a single key such as j.
import type { ReactNode } from 'react';
import './ui.css';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="gg-kbd">{children}</kbd>;
}
