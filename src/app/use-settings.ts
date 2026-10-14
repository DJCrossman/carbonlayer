// The settings as the page last read them, a query of the page's cache shared by the inbox and the PR page, so a move
// between them inside the app finds them at once. Kept in memory only: chrome.storage keeps them already.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Settings } from '../lib/settings';
import type { DataSource } from './data-source';

/**
 * The settings, null until first read, and why they could not be read. The first page to ask reads them; every change
 * saved since, on this page or any other, replaces them (`watchSettings`), and so does `show` with what a save here
 * returned, before that change reaches the page.
 */
export function useSettings(source: DataSource) {
  const queryClient = useQueryClient();
  const read = useQuery({ queryKey: ['settings'], queryFn: () => source.getSettings(), staleTime: Infinity });
  useEffect(() => source.watchSettings((settings) => queryClient.setQueryData(['settings'], settings)), [source, queryClient]);
  return {
    settings: read.data ?? null,
    error: read.error?.message ?? null,
    show: (settings: Settings) => queryClient.setQueryData(['settings'], settings),
  };
}
