import { describe, expect, it, vi } from 'vitest';
import { organizationPeople, peopleIn } from './people';

describe("an organization's people", () => {
  // As GitHub's People page lists them (2026-10-14): the avatar links to the profile with a hovercard, the name link reads
  // the name, or the login again for someone who gave none.
  const member = (id: number, login: string, name: string) =>
    `<li class="d-flex flex-items-center table-list-item member-list-item js-bulk-actions-item" data-bulk-actions-id="${id}">` +
    `<div class="d-flex flex-items-center"><a class="d-inline-block" data-hovercard-type="user" data-hovercard-url="/users/${login}/hovercard" href="/${login}">` +
    `<img class="avatar avatar-user" src="https://avatars.githubusercontent.com/u/${id}?s=88&amp;v=4" width="44" height="44" alt="@${login}"></a></div>` +
    `<div class="py-3 css-truncate pl-3 flex-auto"><a class="f4 d-block" id="member-${login}" data-test-selector="linked-name-is-full-if-exists" href="/${login}">\n  ${name}\n</a></div></li>`;
  const page = (items: string, nextHref?: string) =>
    new DOMParser().parseFromString(
      `<html><body><ul class="table-list">${items}</ul>${nextHref ? `<div class="paginate-container"><div class="pagination"><a class="next_page" rel="next" href="${nextHref}">Next</a></div></div>` : ''}</body></html>`,
      'text/html',
    );

  it('reads each member: the login from the link to their profile, their avatar, and their name unless it is only the login', () => {
    expect(peopleIn(page(member(1001, 'DJCrossman', 'David Crossman') + member(1002, 'denisoffstreet', 'denisoffstreet')), 'acme')).toEqual({
      members: [
        { login: 'DJCrossman', name: 'David Crossman', avatarUrl: 'https://avatars.githubusercontent.com/u/1001?s=88&v=4' },
        { login: 'denisoffstreet', name: null, avatarUrl: 'https://avatars.githubusercontent.com/u/1002?s=88&v=4' },
      ],
      next: null,
    });
  });

  it('reads the next page while one links to it, only pages of the same People page, and at most ten', async () => {
    const pages: Record<string, Document> = {
      '/orgs/acme/people': page(member(1, 'amanda', 'Amanda Liu'), '/orgs/acme/people?page=2'),
      '/orgs/acme/people?page=2': page(member(2, 'dana', 'Dana Reyes') + member(1, 'amanda', 'Amanda Liu'), '/orgs/acme/people/export?page=3'),
    };
    const load = vi.fn(async (path: string) => pages[path]!);
    expect((await organizationPeople({ login: 'acme', isViewer: false }, load)).map((person) => person.login)).toEqual(['amanda', 'dana']);
    expect(load).toHaveBeenCalledTimes(2);

    const endless = vi.fn(async () => page(member(3, 'kenji', 'Kenji Watanabe'), '/orgs/acme/people?page=2'));
    expect(await organizationPeople({ login: 'acme', isViewer: false }, endless)).toHaveLength(1);
    expect(endless).toHaveBeenCalledTimes(10);
  });

  it("asks nothing for the viewer's own account, which has no People page", async () => {
    const load = vi.fn();
    expect(await organizationPeople({ login: 'octocat', isViewer: true }, load)).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
});
