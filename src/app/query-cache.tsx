// The app page's TanStack Query cache. Every move between the inbox and a PR page loads app.html afresh, so the cache is
// kept on the device, in the extension's own IndexedDB, shared by every tab: a page shows what the viewer saw last at once,
// then asks GitHub and updates in place. It is kept per viewer and extension version, and for 24 hours; diffs and comments
// are never kept, and signed out nothing is.
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider, type AsyncStorage, type PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';
import { useEffect, useState, type ReactNode } from 'react';
import type { PrStage } from '../lib/model';
import { GITHUB_ORIGIN, isBridgeMessage, type ParentToAppMessage } from './bridge';

/**
 * The page's queries, kept on the device for `owner` (who is signed in, with which version of the extension), or only in
 * memory when nobody is (signed out, and the harness). Coming back to the page asks GitHub again for what has gone stale.
 */
export function PageQueries({ owner, children }: { owner: CacheOwner | null; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Unused queries stay as long as they are kept on the device, or the next save would drop them.
            gcTime: KEPT_FOR_MS,
            // A failure shows where it happened, with a retry, rather than after three more tries; the content script asks
            // GitHub, so the frame's idea of being online has no say.
            retry: false,
            networkMode: 'always',
          },
        },
      }),
  );
  const [kept] = useState(() => owner && keptOnDevice(owner));
  useEffect(() => focusManager.setEventListener(listenForReturns), []);
  if (!kept) return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return (
    <PersistQueryClientProvider client={client} persistOptions={kept}>
      {children}
    </PersistQueryClientProvider>
  );
}

/** Whose cache a page keeps: the viewer signed in to github.com, with this version of the extension. */
export interface CacheOwner {
  version: string;
  login: string;
}

/**
 * How `owner`'s cache is kept in `storage`: only what loaded, never a diff or a comment, and nothing older than 24 hours.
 * Another viewer or version finds nothing: restoring a cache kept for someone else discards it.
 */
export function keptOnDevice(owner: CacheOwner, storage: AsyncStorage<string> = indexedDbStorage): PersistQueryClientProviderProps['persistOptions'] {
  return {
    persister: createAsyncStoragePersister({ storage, key: 'queries' }),
    maxAge: KEPT_FOR_MS,
    buster: `${owner.version}:${owner.login}`,
    dehydrateOptions: {
      shouldDehydrateQuery: ({ queryKey, state }) =>
        state.status === 'success' &&
        Date.now() - state.dataUpdatedAt < KEPT_FOR_MS &&
        // The diffs, the file list GitHub sends some of them with, the review threads and the timeline stay in memory,
        // asked of GitHub on every page load.
        queryKey[0] !== 'pr-diff' &&
        !(queryKey[0] === 'pr' && IN_MEMORY_STAGES.includes(queryKey[4] as PrStage)),
    },
  };
}

/** How long the device keeps what a page showed. */
const KEPT_FOR_MS = 24 * 60 * 60_000;

/**
 * Tells TanStack Query the viewer came back to the page: the tab shown again, or the window focused again, this frame's
 * own or github.com's, which the parent page forwards (`gg:focus`) because a frame hears nothing of a focus that lands
 * outside it. TanStack then asks GitHub again for each query on the page that has gone stale, and only if the tab shows.
 */
function listenForReturns(onReturn: () => void): () => void {
  const listener = () => onReturn();
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== GITHUB_ORIGIN || event.source !== window.parent || !isBridgeMessage<ParentToAppMessage>(event.data)) return;
    if (event.data.type === 'gg:focus') onReturn();
  };
  window.addEventListener('focus', listener);
  document.addEventListener('visibilitychange', listener);
  window.addEventListener('message', onMessage);
  return () => {
    window.removeEventListener('focus', listener);
    document.removeEventListener('visibilitychange', listener);
    window.removeEventListener('message', onMessage);
  };
}

/** The PR page's stages that hold comments or diffs. */
const IN_MEMORY_STAGES: PrStage[] = ['activity', 'files', 'threads'];

/** One object store in the extension's IndexedDB, opened when first used. */
const indexedDbStorage: AsyncStorage<string> = {
  getItem: (key) => inQueryStore('readonly', (store) => store.get(key) as IDBRequest<string | undefined>),
  setItem: (key, value) => inQueryStore('readwrite', (store) => store.put(value, key)).then(() => {}),
  removeItem: (key) => inQueryStore('readwrite', (store) => store.delete(key)),
};

function inQueryStore<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  database ??= new Promise((resolve, reject) => {
    const opening = indexedDB.open('carbonlayer', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('cache');
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  return database.then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const asked = request(db.transaction('cache', mode).objectStore('cache'));
        asked.onsuccess = () => resolve(asked.result);
        asked.onerror = () => reject(asked.error);
      }),
  );
}

let database: Promise<IDBDatabase> | undefined;
