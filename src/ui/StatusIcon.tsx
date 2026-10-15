// One status column's verdict (src/ui/status-icons.ts) the way Graphite draws it: a 16px icon in its tone, the reason on
// hover anywhere over the cell.
import { Icon } from './Icon';
import type { StatusIcon as Status } from './status-icons';
import './ui.css';

export function StatusIcon({ icon, tone, tooltip }: Status) {
  return (
    <span className={`gg-status-icon gg-status-icon--${tone}`} title={tooltip}>
      <Icon name={icon} size={16} title={tooltip} />
    </span>
  );
}
