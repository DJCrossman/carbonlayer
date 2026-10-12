import { describe, expect, it } from 'vitest';
import type { View } from '../lib/model';
import { importViews, placeGraphiteImport } from './import-views';

const current: View[] = [
  { id: 'needs-review', name: 'Needs your review', query: 'is:pr review-requested:@me', collapsed: true },
  { id: 'mine', name: 'Mine', query: 'is:pr author:@me' },
];
const incoming: View[] = [
  { id: 'needs-review', name: 'Team review', query: 'is:pr team-review-requested:acme/web' },
  { id: 'hotfixes', name: 'Hotfixes', query: 'is:pr label:hotfix' },
];

describe('importViews', () => {
  it('replaces the whole list', () => {
    expect(importViews(current, incoming, 'replace')).toEqual(incoming);
  });

  it('appends after the current views and gives a clashing id a fresh one', () => {
    const result = importViews(current, incoming, 'append');
    expect(result.slice(0, 2)).toEqual(current);
    expect(result[2]).toMatchObject({ name: 'Team review', query: 'is:pr team-review-requested:acme/web' });
    expect(result[2]?.id).not.toBe('needs-review');
    expect(result[3]).toEqual(incoming[1]);
    expect(new Set(result.map((view) => view.id)).size).toBe(4);
  });

  it('replaces a view of the same name, whatever its case, in place and under its own id', () => {
    const again: View[] = [
      { id: 'from-link', name: 'needs your REVIEW ', query: 'is:pr review-requested:@me -author:@me' },
      { id: 'hotfixes', name: 'Hotfixes', query: 'is:pr label:hotfix' },
    ];
    expect(importViews(current, again, 'append')).toEqual([
      { id: 'needs-review', name: 'needs your REVIEW ', query: 'is:pr review-requested:@me -author:@me' },
      current[1],
      again[1],
    ]);
  });

  it.each(['append', 'replace'] as const)('keeps ids unique when the link itself repeats one (%s)', (mode) => {
    const repeated = [incoming[1]!, { ...incoming[1]!, name: 'Hotfixes again' }];
    const result = importViews([], repeated, mode);
    expect(result[0]?.id).toBe('hotfixes');
    expect(result[1]?.id).not.toBe('hotfixes');
  });
});

describe('placeGraphiteImport', () => {
  const acme = { login: 'acme', avatarUrl: '', isViewer: false };
  const globex = { login: 'Globex', avatarUrl: '', isViewer: false };
  const octocat = { login: 'octocat', avatarUrl: '', isViewer: true };
  const drafts: View = {
    id: 'drafts',
    name: 'Drafts',
    query: 'is:pr author:@me draft:true sort:updated-desc',
    filter: { groups: [{ rules: [{ isNegated: false, conditions: [{ kind: 'AUTHOR_IS', username: '@me' }] }, { isNegated: false, conditions: [{ kind: 'CONSOLIDATED_PR_STATUS_IS', status: 'DRAFT' }] }] }] },
  };
  const ownRepos: View = { id: 'ios', name: 'iOS', query: 'is:pr repo:acme/ios', repos: [{ owner: 'acme', name: 'ios' }] };

  it("puts the sections in the organization owning all of Graphite's inbox repositories, which become its inbox's", () => {
    const repos = [{ owner: 'globex', name: 'web' }, { owner: 'globex', name: 'api' }];
    expect(placeGraphiteImport([drafts], repos, acme, [acme, globex, octocat])).toEqual({ org: globex, views: [drafts], inboxRepos: repos });
    expect(placeGraphiteImport([drafts], [{ owner: 'acme', name: 'web' }], acme, [])).toMatchObject({ org: acme, inboxRepos: [{ owner: 'acme', name: 'web' }] });
  });

  it("keeps Graphite's inbox repositories on each section that searched them, in the current organization, when no one organization owns them", () => {
    const repos = [{ owner: 'acme', name: 'web' }, { owner: 'globex', name: 'api' }];
    const placed = placeGraphiteImport([drafts, ownRepos], repos, acme, [acme, globex]);
    expect(placed).toEqual({
      org: acme,
      views: [{ ...drafts, repos, query: 'is:pr (repo:acme/web OR repo:globex/api) author:@me is:open draft:true sort:updated-desc' }, ownRepos],
    });
    expect(placeGraphiteImport([drafts], [{ owner: 'initech', name: 'tps' }], acme, [acme]).views[0]?.repos).toEqual([{ owner: 'initech', name: 'tps' }]);
  });
});
