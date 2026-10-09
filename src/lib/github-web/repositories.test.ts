import { describe, expect, it } from 'vitest';
import { repositoryCandidatesFrom, repositoryPickerPath } from './repositories';

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
});
