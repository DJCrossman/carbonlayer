// Rounded status pill in one of the semantic tones, with optional leading icon.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import './ui.css';

export type PillTone = 'success' | 'attention' | 'danger' | 'done' | 'neutral' | 'accent';

export function StatusPill({ tone, icon, title, children }: { tone: PillTone; icon?: IconName; title?: string; children: ReactNode }) {
  return (
    <span className={`gg-pill gg-pill--${tone}`} title={title}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}
