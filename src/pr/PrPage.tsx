// Placeholder; replaced by the PR page slice.
import type { DataSource } from '../app/data-source';
import type { AppRoute } from '../app/routes';

export function PrPage(_props: { source: DataSource; route: Extract<AppRoute, { page: 'pr' }> }) {
  return <p style={{ padding: 16 }}>PR page coming soon.</p>;
}
