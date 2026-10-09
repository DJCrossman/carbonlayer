// Compact button: default / primary / danger / ghost in sm (24px) or md (28px), optional leading icon; icon-only when no children.
import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import './ui.css';

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost'; size?: 'sm' | 'md'; icon?: IconName }) {
  const iconOnly = children === undefined || children === null;
  return (
    <button
      type={type}
      className={`gg-btn gg-btn--${variant} gg-btn--${size}${iconOnly ? ' gg-btn--icon' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}
