// Rounded status pill in one of the semantic tones, with optional leading icon.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import './ui.css';

export function StatusPill({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'success' | 'attention' | 'danger' | 'done' | 'neutral' | 'accent';
  icon?: IconName;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={`gg-pill gg-pill--${tone}`} title={title}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}
