// Placeholder; replaced by the inbox slice.
import type { DataSource } from '../app/data-source';
import type { AppRoute } from '../app/routes';

export function InboxPage(_props: { source: DataSource; route: Extract<AppRoute, { page: 'inbox' }> }) {
  return <p style={{ padding: 16 }}>Inbox coming soon.</p>;
}
