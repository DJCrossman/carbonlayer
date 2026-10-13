import { describe, expect, it, vi } from 'vitest';
import { pickableRepositories, repositoryCandidatesFrom, repositoryPickerPath, topRepositoriesIn } from './repositories';

describe("GitHub's repository picker", () => {
  it('asks for the repositories the viewer contributed to, narrowed by what was typed', () => {
    expect(repositoryPickerPath('')).toBe('/repositories/picker/search?q=contributed-by%3A%40me');
    expect(repositoryPickerPath('web app')).toBe('/repositories/picker/search?q=contributed-by%3A%40me%20web%20app');
  });

  it.each([
    ['an array', (items: unknown[]) => items],
    ['{ repositories }', (items: unknown[]) => ({ repositories: items })],
    ['{ items }', (items: unknown[]) => ({ items })],
    ['{ results }', (items: unknown[]) => ({ results: items, totalCount: 2 })],
  ])('reads %s of { name, ownerLogin, visibility }, skipping what names no repository', (_, envelope) => {
    const items = [
      { id: 1, nodeId: 'R_1', name: 'web', ownerLogin: 'acme', visibility: 'PRIVATE' },
      { id: 2, nodeId: 'R_2', name: 'hello-world', ownerLogin: 'octocat', visibility: 'public' },
      { id: 3, name: 'orphan' },
      null,
    ];
    expect(repositoryCandidatesFrom(envelope(items))).toEqual([
      { owner: 'acme', name: 'web', isPrivate: true },
      { owner: 'octocat', name: 'hello-world', isPrivate: false },
    ]);
  });

  it('reads nameWithOwner and isPrivate too, and finds nothing in junk', () => {
    expect(repositoryCandidatesFrom([{ nameWithOwner: 'acme/api', isPrivate: false }])).toEqual([{ owner: 'acme', name: 'api', isPrivate: false }]);
    expect(repositoryCandidatesFrom({ error: 'Not Found' })).toEqual([]);
    expect(repositoryCandidatesFrom(null)).toEqual([]);
  });

  it("narrows the picker to one organization's repositories with a qualifier, else by owner", async () => {
    const answers: Record<string, unknown> = {
      [repositoryPickerPath('org:acme web')]: [{ name: 'web', ownerLogin: 'acme' }],
      [repositoryPickerPath('user:octocat web')]: [],
      [repositoryPickerPath('web')]: [{ name: 'web', ownerLogin: 'acme' }, { name: 'webby', ownerLogin: 'octocat' }],
    };
    const load = vi.fn(async (path: string) => answers[path]);
    expect(await pickableRepositories('web', { login: 'acme', isViewer: false }, load)).toEqual([{ owner: 'acme', name: 'web', isPrivate: false }]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await pickableRepositories('web', { login: 'octocat', isViewer: true }, load)).toEqual([{ owner: 'octocat', name: 'webby', isPrivate: false }]);
    expect(await pickableRepositories('web', null, load)).toHaveLength(2);
  });
});

describe("the homepage's top repositories", () => {
  // As GitHub's dashboard fragments list them (2026-10-13): the owner's avatar and the name each link to the repository.
  const item = (owner: string, name: string, avatar = `<img src="https://avatars.githubusercontent.com/u/1?s=40&amp;v=4" alt="${name}">`) =>
    `<li><div><a href="/${owner}/${name}">${avatar}</a><div><a href="/${owner}/${name}"><span>${owner}<span>/</span>${name}</span></a></div></div></li>`;
  const showMore = (cursor: string) =>
    `<form class="ajax-pagination-form js-ajax-pagination js-more-repos-form" method="get" action="/dashboard/ajax_my_repositories?location=left">` +
    `<input type="hidden" name="repos_cursor" value="${cursor}"><button type="submit">Show more</button></form>`;

  it('reads each item once, by its link, with the owner\'s avatar and the cursor of "Show more"', () => {
    const html =
      `<h2 id="dashboard-top-repositories-heading">Top repositories</h2><a href="/new">New</a>` +
      `<ul class="list-style-none js-dashboard-repos-list">${item('acme', 'widgets')}${item('octocat', 'hello-world', '')}</ul>${showMore('7')}`;
    expect(topRepositoriesIn(html)).toEqual({
      repos: [
        { owner: 'acme', name: 'widgets', url: 'https://github.com/acme/widgets', avatarUrl: 'https://avatars.githubusercontent.com/u/1?s=40&v=4' },
        { owner: 'octocat', name: 'hello-world', url: 'https://github.com/octocat/hello-world', avatarUrl: null },
      ],
      nextCursor: 7,
    });
  });

  it('has no next page without the "Show more" form', () => {
    expect(topRepositoriesIn(`<ul class="list-style-none js-dashboard-repos-list">${item('acme', 'api')}</ul>`)).toEqual({
      repos: [{ owner: 'acme', name: 'api', url: 'https://github.com/acme/api', avatarUrl: 'https://avatars.githubusercontent.com/u/1?s=40&v=4' }],
      nextCursor: null,
    });
  });
});
