import { QueryClient } from '@tanstack/react-query';
import { persistQueryClientRestore, persistQueryClientSave, type AsyncStorage } from '@tanstack/react-query-persist-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keptOnDevice } from './query-cache';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('keptOnDevice', () => {
  it("keeps what a PR page loaded, except its diffs, file list, threads and timeline, anything that failed, and the settings", async () => {
    const storage = memoryStorage();
    const page = new QueryClient();
    for (const stage of ['header', 'stack', 'activity', 'files', 'threads', 'mergeBox', 'checks', 'meta']) page.setQueryData(['pr', 'o', 'r', 1, stage], { stage });
    page.setQueryData(['pr-diff', 'o', 'r', 1, 'head', 'main', 'a.ts'], { patch: '@@' });
    page.setQueryData(['settings'], { diffLayout: 'split' });
    await page.prefetchQuery({ queryKey: ['pr', 'o', 'r', 2, 'header'], queryFn: () => Promise.reject(new Error('GitHub answered 502')), retry: false });
    await persistQueryClientSave({ queryClient: page, ...keptOnDevice(ana, storage) });

    expect(await restored(ana, storage)).toEqual([
      ['pr', 'o', 'r', 1, 'header'],
      ['pr', 'o', 'r', 1, 'stack'],
      ['pr', 'o', 'r', 1, 'mergeBox'],
      ['pr', 'o', 'r', 1, 'checks'],
      ['pr', 'o', 'r', 1, 'meta'],
    ]);
  });

  it('restores nothing for another viewer, another version or another build of the extension, and nothing older than 24 hours', async () => {
    const save = async (storage: AsyncStorage<string>) => {
      const page = new QueryClient();
      page.setQueryData(['pr', 'o', 'r', 1, 'header'], { title: 'Fix the widget' });
      await persistQueryClientSave({ queryClient: page, ...keptOnDevice(ana, storage) });
      return storage;
    };
    expect(await restored({ version: '1.0.0', login: 'bo' }, await save(memoryStorage()))).toEqual([]);
    expect(await restored({ version: '1.0.1', login: 'ana' }, await save(memoryStorage()))).toEqual([]);
    vi.stubEnv('BUILD_ID', '2026-10-15T09:00:00.000Z');
    const keptByTheLastBuild = await save(memoryStorage());
    vi.stubEnv('BUILD_ID', '2026-10-15T10:00:00.000Z');
    expect(await restored(ana, keptByTheLastBuild)).toEqual([]);

    const storage = await save(memoryStorage());
    vi.useFakeTimers({ now: Date.now() + 24 * 60 * 60_000 + 1 });
    expect(await restored(ana, storage)).toEqual([]);
  });

  it('discards a kept cache of another shape than this build saves', async () => {
    const storage = memoryStorage();
    await storage.setItem('queries', JSON.stringify({ timestamp: Date.now(), buster: 'anything', clientState: { queries: [{ queryKey: ['pr'] }], mutations: [] } }));
    await expect(restored(ana, storage)).rejects.toThrow();
    expect(await storage.getItem('queries')).toBeUndefined();
  });
});

const ana = { version: '1.0.0', login: 'ana' };

/** The query keys a new page restores from `storage` for `owner`. */
async function restored(owner: { version: string; login: string }, storage: AsyncStorage<string>) {
  const page = new QueryClient();
  await persistQueryClientRestore({ queryClient: page, ...keptOnDevice(owner, storage) });
  return page
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey);
}

function memoryStorage(): AsyncStorage<string> {
  const items = new Map<string, string>();
  return {
    getItem: async (key) => items.get(key),
    setItem: async (key, value) => void items.set(key, value),
    removeItem: async (key) => void items.delete(key),
  };
}
