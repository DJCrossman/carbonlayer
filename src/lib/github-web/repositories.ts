// GitHub's repository picker (the dashboard's repository filter): `GET /repositories/picker/search?q=`, which GitHub's
// own picker opens with `q=contributed-by:@me`. The envelope of its answer is unconfirmed (docs/research/
// graphite-sections.md, "GitHub's repository picker"), so it is read tolerantly.

import type { Organization, RepoCandidate } from '../model';

/**
 * The repositories GitHub's repository picker offers for `text` among those the viewer contributed to, only `owner`'s when
 * given. The picker is asked with search's own `org:` / `user:` qualifier, and asked again without it, keeping the owner's,
 * should that bring none of theirs (GitHub's picker may not take qualifiers). `load` reaches github.com with the user's
 * session.
 */
export async function pickableRepositories(text: string, owner: Pick<Organization, 'login' | 'isViewer'> | null, load: (path: string) => Promise<unknown>): Promise<RepoCandidate[]> {
  if (!owner) return repositoryCandidatesFrom(await load(repositoryPickerPath(text)));
  const owned = (data: unknown) => repositoryCandidatesFrom(data).filter((repo) => repo.owner.toLowerCase() === owner.login.toLowerCase());
  const qualified = await load(repositoryPickerPath(`${owner.isViewer ? 'user' : 'org'}:${owner.login} ${text}`)).then(owned, () => []);
  return qualified.length > 0 ? qualified : owned(await load(repositoryPickerPath(text)));
}

/** The picker request for the repositories matching `text` among those the viewer contributed to, as GitHub's own asks. */
export function repositoryPickerPath(text: string): string {
  return `/repositories/picker/search?q=${encodeURIComponent(`contributed-by:@me ${text}`.trim())}`;
}

/**
 * The repositories in the picker's answer: an array, or one under `repositories`, `items` or `results`, of
 * `{ id, nodeId, name, ownerLogin, visibility }` (also `nameWithOwner`, `owner.login` and `isPrivate` / `private`).
 * Items without an owner and a name are skipped.
 */
export function repositoryCandidatesFrom(data: unknown): RepoCandidate[] {
  const record = (data ?? {}) as Record<string, unknown>;
  const items: unknown[] = Array.isArray(data) ? data : ([record.repositories, record.items, record.results].find(Array.isArray) ?? []);
  return items.flatMap((item): RepoCandidate[] => {
    const repo = (item ?? {}) as {
      name?: unknown;
      ownerLogin?: unknown;
      owner?: { login?: unknown } | null;
      nameWithOwner?: unknown;
      visibility?: unknown;
      isPrivate?: unknown;
      private?: unknown;
    };
    const fullName = typeof repo.nameWithOwner === 'string' ? repo.nameWithOwner : typeof repo.name === 'string' && repo.name.includes('/') ? repo.name : null;
    const [owner, name] = fullName ? fullName.split('/') : [repo.ownerLogin ?? repo.owner?.login, repo.name];
    if (typeof owner !== 'string' || typeof name !== 'string' || !owner || !name) return [];
    const isPrivate =
      typeof repo.isPrivate === 'boolean' ? repo.isPrivate : typeof repo.private === 'boolean' ? repo.private : typeof repo.visibility === 'string' && repo.visibility.toLowerCase() !== 'public';
    return [{ owner, name, isPrivate }];
  });
}
