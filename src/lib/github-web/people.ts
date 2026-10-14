// An organization's people, as its People page lists them (`GET /orgs/<login>/people`, HTML, signed in): whom the
// section editor's username fields offer. Seen signed in on a 14-member organization, every member on one page; how the
// page splits a bigger one has not been seen, so pages are read while one links to the next (GitHub's classic lists page
// with `?page=N`), at most ten (docs/research/github-web-endpoints.md).

import type { Organization, OrgMember } from '../model';

/**
 * Everyone in `org`, in the order its People page lists them; nobody for the viewer's own account, which has no such
 * page. `load` reaches github.com with the user's session (from the content script, same-origin; from the options page,
 * github.com itself).
 */
export async function organizationPeople(org: Pick<Organization, 'login' | 'isViewer'>, load: (path: string) => Promise<Document>): Promise<OrgMember[]> {
  if (org.isViewer) return [];
  const people = new Map<string, OrgMember>();
  let path: string | null = `/orgs/${org.login}/people`;
  for (let pages = 0; path && pages < 10; pages++) {
    const { members, next } = peopleIn(await load(path), org.login);
    for (const member of members) if (!people.has(member.login.toLowerCase())) people.set(member.login.toLowerCase(), member);
    path = next;
  }
  if (people.size === 0) console.debug('[gg]', `orgs/${org.login}/people listed nobody; the section editor offers only @me`);
  return [...people.values()];
}

/**
 * The people on a page of `orgLogin`'s People page, one `li.member-list-item` each: the login from the link to their
 * profile (`/<login>`) around their avatar, the avatar, and the name the `linked-name-is-full-if-exists` link reads (the
 * login again for someone who gave no name). `next` is the page its pagination links to next (`a[rel="next"]`), only
 * another page of the same People page; null on the last.
 */
export function peopleIn(page: Document, orgLogin: string): { members: OrgMember[]; next: string | null } {
  const members = [...page.querySelectorAll('li.member-list-item')].flatMap((item): OrgMember[] => {
    const nameLink = item.querySelector('a[data-test-selector="linked-name-is-full-if-exists"]');
    const href = (item.querySelector('a[data-hovercard-type="user"][href]') ?? nameLink)?.getAttribute('href');
    const login = href ? /^\/([\w-]+)\/?$/.exec(new URL(href, 'https://github.com').pathname)?.[1] : undefined;
    if (!login) return [];
    const name = nameLink?.textContent?.replace(/\s+/g, ' ').trim();
    return [{ login, name: name && name.toLowerCase() !== login.toLowerCase() ? name : null, avatarUrl: item.querySelector('img[src]')?.getAttribute('src') || `https://github.com/${login}.png?size=40` }];
  });
  const nextHref = page.querySelector('a[rel~="next"][href]')?.getAttribute('href');
  const next = nextHref ? new URL(nextHref, `https://github.com/orgs/${orgLogin}/people`) : null;
  return { members, next: next && next.origin === 'https://github.com' && next.pathname.toLowerCase() === `/orgs/${orgLogin}/people`.toLowerCase() ? next.pathname + next.search : null };
}
