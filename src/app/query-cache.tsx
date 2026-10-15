// The app page's TanStack Query cache. A tab's moves between the inbox and PR pages keep the app, and the cache with it;
// every page load (a new tab, a reload) starts the app afresh, so the cache is also kept on the device, in the extension's
// own IndexedDB, shared by every tab: a page shows what the viewer saw last at once, then asks GitHub and updates in place.
// It is kept per viewer, extension version and build, and for 24 hours; diffs and comments are never kept, and signed out
// nothing is. A page never waits more than a second for the device.
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, QueryClient, QueryClientProvider, useIsRestoring } from '@tanstack/react-query';
import { PersistQueryClientProvider, persistQueryClientSave, type AsyncStorage, type PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client';
import { createContext, useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod/mini';
import type { PrStage } from '../lib/model';
import { GITHUB_ORIGIN, parentToAppMessage } from './bridge';

/**
 * The page's queries, kept on the device for `owner` (who is signed in, with which version of the extension), or only in
 * memory when nobody is (signed out, the harness, the options page). The page renders once what was kept is back (or a
 * second has gone by without IndexedDB answering), so its first frame shows it, and saves what it has as it goes
 * (SaveCacheNow). Coming back to the page asks GitHub again for what has gone stale.
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
  // The cache is saved within a second of a change; a page about to go saves it at once, so the next finds it all.
  const [saveNow] = useState(() => async () => {
    if (owner) await persistQueryClientSave({ queryClient: client, ...keptOnDevice(owner, indexedDbStorage, 0) });
  });
  useEffect(() => focusManager.setEventListener(listenForReturns), []);
  useEffect(() => {
    const onHide = () => void saveNow();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [saveNow]);
  if (!kept) return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return (
    <PersistQueryClientProvider client={client} persistOptions={kept}>
      <SaveCacheNow value={saveNow}>
        <Restored>{children}</Restored>
      </SaveCacheNow>
    </PersistQueryClientProvider>
  );
}

/** Saves the page's cache on the device now: before opening a PR, so its page finds what the inbox loaded for it. */
export const SaveCacheNow = createContext<() => Promise<void>>(() => Promise.resolve());

/** The stages of the PR page kept on the device: never one with comments or diffs (the timeline, files, threads). */
export const KEPT_STAGES: PrStage[] = ['header', 'stack', 'mergeBox', 'checks', 'meta'];

/** Whose cache a page keeps: the viewer signed in to github.com, with this version of the extension. */
export interface CacheOwner {
  version: string;
  login: string;
}

/**
 * How `owner`'s cache is kept in `storage`, saved at most once every `throttleTime` ms: only what loaded, never a diff or a
 * comment, and nothing older than 24 hours. Another viewer, version or build finds nothing (restoring a cache kept for
 * someone else discards it): what one build kept may not be what the next one reads. What is restored is read as a cache
 * this build saves (keptCacheSchema), else it is discarded and the page asks GitHub.
 */
export function keptOnDevice(owner: CacheOwner, storage: AsyncStorage<string> = indexedDbStorage, throttleTime = 1000): PersistQueryClientProviderProps['persistOptions'] {
  return {
    persister: createAsyncStoragePersister({ storage, key: 'queries', throttleTime, deserialize: (kept) => keptCacheSchema.parse(JSON.parse(kept)) }),
    maxAge: KEPT_FOR_MS,
    buster: `${owner.version}:${owner.login}:${import.meta.env.BUILD_ID}`,
    dehydrateOptions: {
      shouldDehydrateQuery: ({ queryKey, state }) =>
        state.status === 'success' &&
        Date.now() - state.dataUpdatedAt < KEPT_FOR_MS &&
        // The diffs, the file list GitHub sends some of them with, the review threads and the timeline stay in memory,
        // asked of GitHub on every page load. chrome.storage keeps the settings.
        queryKey[0] !== 'pr-diff' &&
        queryKey[0] !== 'settings' &&
        (queryKey[0] !== 'pr' || KEPT_STAGES.some((stage) => stage === queryKey[4])),
    },
  };
}

/**
 * Forgets what the device keeps and saves nothing more from this page, which could not show what it restored: the next
 * page load asks GitHub for everything.
 */
export function forgetKeptCache(): Promise<void> {
  forgotten = true;
  return inQueryStore('readwrite', (store) => store.clear()).then(() => {});
}

/** How long the device keeps what a page showed. */
const KEPT_FOR_MS = 24 * 60 * 60_000;

/**
 * The page's cache the way TanStack saves it (`persistQueryClientSave`): when, for whom (the buster) and each query that
 * had loaded, its data as the query answered it, which the page's readers read in turn. The page runs no mutations
 * through TanStack, so none is kept.
 */
const keptCacheSchema = z.object({
  timestamp: z.number(),
  buster: z.string(),
  clientState: z.object({
    mutations: z.array(z.never()),
    queries: z.array(
      z.object({
        queryHash: z.string(),
        queryKey: z.array(z.unknown()),
        dehydratedAt: z.number(),
        // Only queries that loaded are kept, so they hold no error.
        state: z.object({
          data: z.unknown(),
          dataUpdateCount: z.number(),
          dataUpdatedAt: z.number(),
          error: z.null(),
          errorUpdateCount: z.number(),
          errorUpdatedAt: z.number(),
          fetchFailureCount: z.number(),
          fetchFailureReason: z.null(),
          fetchMeta: z.nullable(z.object({ fetchMore: z.optional(z.object({ direction: z.enum(['forward', 'backward']) })) })),
          isInvalidated: z.boolean(),
          status: z.enum(['pending', 'error', 'success']),
          fetchStatus: z.enum(['fetching', 'paused', 'idle']),
        }),
        meta: z.optional(z.record(z.string(), z.unknown())),
        queryType: z.optional(z.literal('infinite')),
      }),
    ),
  }),
});

/** Nothing until the cache kept on the device is back (a few milliseconds), rather than skeletons for what it holds. */
function Restored({ children }: { children: ReactNode }) {
  return useIsRestoring() ? null : children;
}

/**
 * Tells TanStack Query the viewer came back to the page: the tab shown again, or the window focused again, this frame's
 * own or github.com's, which the parent page forwards (`gg:focus`) because a frame hears nothing of a focus that lands
 * outside it. TanStack then asks GitHub again for each query on the page that has gone stale, and only if the tab shows.
 */
function listenForReturns(onReturn: () => void): () => void {
  const listener = () => onReturn();
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== GITHUB_ORIGIN || event.source !== window.parent) return;
    // GitHub's own page posts to this frame too.
    if (parentToAppMessage.safeParse(event.data).data?.type === 'gg:focus') onReturn();
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

/**
 * One object store in the extension's IndexedDB, opened when first used. What it holds is read as the string a save put
 * there, else the read fails and the cache is discarded. Once the page has forgotten what it kept (forgetKeptCache), it
 * saves nothing more.
 */
const indexedDbStorage: AsyncStorage<string> = {
  getItem: (key) => inQueryStore('readonly', (store) => store.get(key)).then((kept: unknown) => z.optional(z.string()).parse(kept)),
  setItem: (key, value) => (forgotten ? undefined : inQueryStore('readwrite', (store) => store.put(value, key)).then(() => {})),
  removeItem: (key) => inQueryStore('readwrite', (store) => store.delete(key)),
};

/**
 * Asks the cache's object store, for a second at most: IndexedDB may never answer (an open waiting behind another tab's
 * upgrade), and the page goes on without it, restoring nothing (undefined) and no longer waiting for a save.
 */
function inQueryStore<T,>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  database ??= new Promise((resolve, reject) => {
    const opening = indexedDB.open('carbonlayer', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('cache');
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  const answered = database.then(
    (db): Promise<T> =>
      new Promise((resolve, reject) => {
        const asked = request(db.transaction('cache', mode).objectStore('cache'));
        asked.onsuccess = () => resolve(asked.result);
        asked.onerror = () => reject(asked.error);
      }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unanswered = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      console.warn('[gg]', `IndexedDB did not answer within a second (${mode}); the page goes on without it`);
      resolve(undefined);
    }, 1000);
  });
  return Promise.race([answered, unanswered]).finally(() => clearTimeout(timer));
}

let database: Promise<IDBDatabase> | undefined;
let forgotten = false;

declare global {
  interface ImportMetaEnv {
    /** This build of the extension, the time it was made (wxt.config.ts). */
    readonly BUILD_ID: string;
  }
}
