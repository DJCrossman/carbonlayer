// Compact age of a timestamp ("18m", "13h", "4d", "3w"), full date on hover, red once older than `overdueAfterHours`;
// nothing for a time GitHub did not give (an empty or unreadable date).
import { useSyncExternalStore } from 'react';
import './ui.css';

export function RelativeTime({ date, overdueAfterHours, ago = false }: { date: string; overdueAfterHours?: number; ago?: boolean }) {
  // One shared 30 s clock keeps every visible age current.
  const now = useSyncExternalStore(subscribeToClock, () => clock);
  const then = Date.parse(date);
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  let age: string;
  if (minutes < 1) age = ago ? 'just now' : 'now';
  else {
    if (minutes < 60) age = `${minutes}m`;
    else if (hours < 24) age = `${hours}h`;
    else if (days < 7) age = `${days}d`;
    else if (days < 56) age = `${Math.floor(days / 7)}w`;
    else if (days < 365) age = `${Math.floor(days / 30)}mo`;
    else age = `${Math.floor(days / 365)}y`;
    if (ago) age += ' ago';
  }
  const overdue = overdueAfterHours !== undefined && hours >= overdueAfterHours;
  return (
    <time
      className={overdue ? 'gg-time is-overdue' : 'gg-time'}
      dateTime={date}
      title={`${new Date(then).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}${overdue ? ` · over ${overdueAfterHours}h` : ''}`}
    >
      {age}
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
