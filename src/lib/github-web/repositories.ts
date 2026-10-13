// GitHub's repository picker (the dashboard's repository filter): `GET /repositories/picker/search?q=`, which GitHub's
// own picker opens with `q=contributed-by:@me`. The envelope of its answer is unconfirmed (docs/research/
// graphite-sections.md, "GitHub's repository picker"), so it is read tolerantly. Also the homepage's "Top repositories",
// which GitHub's dashboard loads as classic HTML fragments (docs/research/github-web-endpoints.md).

import type { Organization, RepoCandidate, TopRepository } from '../model';
import { request } from './session';

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

/**
 * A page of the repositories GitHub's homepage lists under "Top repositories": the first, or with `cursor` the one its
 * "Show more" asks for next. Both are HTML fragments GitHub's dashboard loads with its own scripts' header.
 */
export async function topRepositories(cursor: number | null = null): Promise<{ repos: TopRepository[]; nextCursor: number | null }> {
  const path = cursor === null ? '/dashboard/my_top_repositories?location=left' : `/dashboard/ajax_my_repositories?location=left&repos_cursor=${cursor}`;
  return topRepositoriesIn(await (await request(path, 'text/html', { xhr: true })).text());
}

/**
 * The repositories in a page of "Top repositories", one a list item (`ul.js-dashboard-repos-list > li`, which links to
 * `/<owner>/<name>` from the owner's avatar and again from the name; owner and name come from that path, not the text),
 * and the cursor the page's "Show more" form asks for the next with; null without that form, on the last page.
 */
export function topRepositoriesIn(html: string): { repos: TopRepository[]; nextCursor: number | null } {
  const page = new DOMParser().parseFromString(html, 'text/html');
  const repos = [...page.querySelectorAll('ul.js-dashboard-repos-list > li')].flatMap((item): TopRepository[] => {
    const [owner, name] =
      [...item.querySelectorAll('a[href]')]
        .map((link) => new URL(link.getAttribute('href')!, 'https://github.com'))
        .filter((url) => url.origin === 'https://github.com')
        .map((url) => url.pathname.split('/').filter(Boolean))
        .find((segments) => segments.length === 2) ?? [];
    if (!owner || !name) return [];
    return [{ owner, name, url: `https://github.com/${owner}/${name}`, avatarUrl: item.querySelector('img[src]')?.getAttribute('src') || null }];
  });
  const cursor = Number.parseInt(page.querySelector('form.js-more-repos-form input[name="repos_cursor"]')?.getAttribute('value') ?? '', 10);
  return { repos, nextCursor: Number.isInteger(cursor) ? cursor : null };
}
