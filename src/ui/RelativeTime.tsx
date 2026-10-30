// Compact age of a timestamp ("18m", "13h", "2d", "15d", "2mo"), full date on hover, red once older than `overdueAfterHours`;
// nothing for a time GitHub did not give (an empty or unreadable date).
import { useSyncExternalStore } from 'react';
import './ui.css';

export function RelativeTime({ date, overdueAfterHours, ago = false }: { date: string; overdueAfterHours?: number; ago?: boolean }) {
  // One shared 30 s clock keeps every visible age current.
  const now = useSyncExternalStore(subscribeToClock, () => clock);
  const then = Date.parse(date);
  if (Number.isNaN(then)) return null;
  const overdue = overdueAfterHours !== undefined && now - then >= overdueAfterHours * 3_600_000;
  return (
    <time
      className={overdue ? 'gg-time is-overdue' : 'gg-time'}
      dateTime={date}
      title={`${new Date(then).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}${overdue ? ` · over ${overdueAfterHours}h` : ''}`}
    >
      {ageOf(then, now, ago)}
    </time>
  );
}

let clock = Date.now();
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | undefined;

function subscribeToClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockTimer === undefined) clock = Date.now();
  clockTimer ??= setInterval(() => {
    clock = Date.now();
    for (const notify of clockListeners) notify();
  }, 30_000);
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

/**
 * How old a time reads. Compact, as Graphite's inbox and stack rows count it: minutes and hours floored, then days rounded
 * from the hours and kept up to a month, never weeks ("2d" for 41 hours, "9d" for 8.7 days), then months and years, rounded.
 * With `ago`, as Graphite's long form reads, which still counts weeks ("17h ago", "1w ago").
 */
export function ageOf(then: number, now: number, ago: boolean): string {
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  const hours = Math.floor(minutes / 60);
  if (minutes < 1) return ago ? 'just now' : 'now';
  if (minutes < 60) return ago ? `${minutes}m ago` : `${minutes}m`;
  if (hours < 24) return ago ? `${hours}h ago` : `${hours}h`;
  if (ago) {
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    if (days < 56) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30.44)}mo`;
  return `${Math.round(days / 365.25)}y`;
}
