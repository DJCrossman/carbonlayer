// Bordered container with an optional header row (inbox sections, PR sidebar cards).
import type { ReactNode } from 'react';
import './ui.css';

export function Card({ header, className, children }: { header?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <section className={className ? `gg-card ${className}` : 'gg-card'}>
      {header !== undefined && <header className="gg-card__header">{header}</header>}
      {children}
    </section>
  );
}
