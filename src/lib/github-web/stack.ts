// Where the PR sits in its stack: GitHub's native stack (from the PR page's layout data) first, else the
// stack Graphite lists in its PR comment, else the PR alone.

import { z } from 'zod/mini';
import type { GraphiteStackPlace, PrSummary, Stack, StackEntry, UserRef } from '../model';
import { githubUser, politely } from './session';

export async function resolveStack(
  subject: { current: PrSummary; nativeStack: NativeStack | null; page: Document },
  lookups: {
    /** An entry's own page_data/stack_mergeability: GitHub's verdict on merging it with those below it; null when GitHub did not answer. */
    mergeability(number: number): Promise<StackMergeabilityAnswer | null>;
    /** The author's open PRs in this repository, for the Graphite comment's entries; empty when GitHub did not answer. */
    authorsOpenPulls(): Promise<PrSummary[]>;
    /** Another entry's conversations, from its own page_data/threads; null when GitHub did not answer. */
    conversations(number: number): Promise<PrSummary['conversations']>;
    /**
     * Another entry's own page_data/header, for who opened it and, for an entry the stack's listing names by its number
     * alone, its title and state; null when GitHub did not answer.
     */
    header(number: number): Promise<AuthorHeaderAnswer | null>;
  },
): Promise<Stack> {
  const { current, nativeStack } = subject;

  if (nativeStack && nativeStack.pulls.length > 0) {
    // GitHub lists the top of the stack first; position 1 is the PR closest to trunk.
    const bottomFirst = [...nativeStack.pulls].reverse();
    const viewedIndex = bottomFirst.findIndex((pull) => pull.number === current.number);
    // Merging the viewed PR as a stack merges every open PR from the bottom up to it, so GitHub's merge box asks each of
    // them its own verdict, three at a time here; the PRs above it are neither merged nor asked.
    const merging = bottomFirst.slice(0, viewedIndex + 1).filter((pull) => pull.state === 'OPEN');
    const verdicts = new Map(await politely(merging, 3, async (pull) => [pull.number, await lookups.mergeability(pull.number)] as const));
    const viewed: StackEntry = { ...current, parentNumber: bottomFirst[viewedIndex - 1]?.number ?? null, readyToMergeAsStack: verdicts.get(current.number)?.effectiveEntryStatus === 'READY' };
    const entries = bottomFirst.map((pull, index) =>
      pull.number === current.number
        ? viewed
        : stackNeighbour(current, {
            number: pull.number,
            title: pull.title,
            url: new URL(pull.url, 'https://github.com').href,
            state: pull.state === 'MERGED' || pull.state === 'CLOSED' ? pull.state : 'OPEN',
            isDraft: pull.state === 'DRAFT',
            headRefName: pull.headBranch,
            // The head of the PR below it; trunk for the bottom one.
            baseRefName: bottomFirst[index - 1]?.headBranch ?? nativeStack.baseBranch,
            parentNumber: bottomFirst[index - 1]?.number ?? null,
            mergeStatus: pull.state === 'DRAFT' ? 'DRAFT' : verdicts.get(pull.number)?.state === 'MERGEABLE' ? 'CLEAN' : 'UNKNOWN',
            nativeStack: { position: index + 1, size: nativeStack.size },
            readyToMergeAsStack: verdicts.get(pull.number)?.effectiveEntryStatus === 'READY',
          }),
    );
    return { entries: await withConversationsAndAuthors(entries, viewed, lookups), forks: [], currentIndex: entries.indexOf(viewed), trunk: nativeStack.baseBranch, source: 'native' };
  }

  const comment = graphiteStackComment(subject.page);
  if (comment && (comment.entries.length > 1 || comment.forks.length > 0) && comment.entries.some((entry) => entry.number === current.number)) {
    const open = new Map((await lookups.authorsOpenPulls()).map((pull) => [pull.number, pull]));
    // At most 25 entries, centred on the PR being viewed, and the forks off them.
    const index = comment.entries.findIndex((entry) => entry.number === current.number);
    const start = Math.max(0, Math.min(index - 12, comment.entries.length - 25));
    const line = comment.entries.slice(start, start + 25);
    const forks = comment.forks.filter((fork) => line.some((entry) => entry.number === fork.parentNumber));
    const named = [...line, ...forks].map((entry): StackEntry => {
      const known = entry.number === current.number ? current : open.get(entry.number);
      return known
        ? { ...known, parentNumber: entry.parentNumber }
        : stackNeighbour(current, { ...entry, headRefName: '', baseRefName: '', mergeStatus: entry.isDraft ? 'DRAFT' : 'UNKNOWN', nativeStack: null });
    });
    const found = await withConversationsAndAuthors(named, current, lookups);
    return {
      entries: found.slice(0, line.length),
      forks: found.slice(line.length),
      currentIndex: line.findIndex((entry) => entry.number === current.number),
      trunk: comment.trunk ?? current.baseRefName,
      source: 'graphite-comment',
    };
  }

  return { entries: [{ ...current, parentNumber: null }], forks: [], currentIndex: 0, trunk: current.baseRefName, source: 'none' };
}

/**
 * The stack Graphite's PR comment lists, or null when the conversation has no such comment. The comment lists one line of
 * the stack, the PR's own, from the top down: an item `* **#123**` for each PR, the viewed one marked 👈, and the trunk
 * last as `* \`main\``. GitHub renders each item's number as a reference link with the PR's title and a state icon. An
 * entry that other PRs branch off says so after its own link, `: 1 other dependent PR ([#9003](…))`, or, at the top of
 * the line with more than one, `: 2  dependent PRs ([#9002](…), [#9003](…))`, plain links to PRs whose own items the
 * comment does not have (read on offstreetparking/core#9029, #9604, #9003 and #8994, 2026-10-31). So `entries` is the
 * line bottom first, each with the entry below it as its parent (null on trunk), and `forks` the PRs off the line, each
 * with the entry whose item names it as its parent; the comment names nothing above a fork.
 */
export function graphiteStackComment(page: Document): { entries: GraphiteEntry[]; forks: GraphiteEntry[]; trunk: string | null } | null {
  const body = [...page.querySelectorAll('.timeline-comment-group[id^="issuecomment-"] .comment-body')].find((element) =>
    element.textContent?.includes('This stack of pull requests is managed by'),
  );
  if (!body) return null;
  const topFirst: Array<Omit<GraphiteEntry, 'parentNumber'>> = [];
  const forks: GraphiteEntry[] = [];
  let trunk: string | null = null;
  for (const item of body.querySelectorAll('li')) {
    const [link, ...dependents] = [...item.querySelectorAll('a[href*="/pull/"]')];
    const number = Number(/\/pull\/(\d+)/.exec(link?.getAttribute('href') ?? '')?.[1] ?? /#(\d+)/.exec(item.textContent ?? '')?.[1]);
    if (number) {
      topFirst.push(pullNamedBy(link, number, item.querySelector('svg.octicon')));
      // The PRs its item names as branching off it, each with a state icon only where GitHub rendered its link as a
      // reference.
      for (const dependent of dependents) {
        const fork = Number(/\/pull\/(\d+)/.exec(dependent.getAttribute('href') ?? '')?.[1]);
        if (fork) forks.push({ ...pullNamedBy(dependent, fork, dependent.closest('.reference')?.querySelector('svg.octicon') ?? null), parentNumber: number });
      }
    } else if (item.querySelector(':scope > code')) {
      trunk = item.querySelector(':scope > code')?.textContent?.trim() ?? null;
    }
  }
  const entries = topFirst.reverse().map((entry, index, bottomFirst) => ({ ...entry, parentNumber: bottomFirst[index - 1]?.number ?? null }));
  return entries.length > 0 ? { entries, forks, trunk } : null;
}

/**
 * Where the PR numbered `number` sits in the stack Graphite's comment lists, as Graphite's inbox chip counts it: its place
 * on its own line, merged and closed entries too, of how many entries the line has, the forks off it left out (core#9029,
 * with #9003 branching off its #8994, reads 6/6). The comment on a PR's page lists that PR's own line; a PR it names as a
 * fork counts its own line all the same: the entries below it down to trunk, itself, and the forks that continue it, as
 * its own page's comment would list them. Null when the comment does not name the PR, or its line is the PR alone.
 */
export function graphiteStackPlace(comment: { entries: GraphiteEntry[]; forks: GraphiteEntry[] }, number: number): GraphiteStackPlace | null {
  const index = comment.entries.findIndex((entry) => entry.number === number);
  if (index >= 0) return comment.entries.length > 1 ? { position: index + 1, size: comment.entries.length } : null;
  const fork = comment.forks.find((entry) => entry.number === number);
  if (!fork) return null;
  const named = [...comment.entries, ...comment.forks];
  let below = 0;
  for (let parent = fork.parentNumber; parent !== null; parent = named.find((entry) => entry.number === parent)?.parentNumber ?? null) below++;
  let above = 0;
  for (let child = comment.forks.find((entry) => entry.parentNumber === number); child; child = comment.forks.find((entry) => entry.parentNumber === child.number)) above++;
  return { position: below + 1, size: below + 1 + above };
}

/**
 * Who opened a PR, as its page header (`page_data/header`) names them, for its entry in another PR's stack:
 * `pullRequest.author`, a bot or app the way GitHub gives it, and the ghost account when GitHub names nobody, like the PR's
 * own page does. Null when the header says nothing about the pull request.
 */
export function authorIn(header: AuthorHeaderAnswer): UserRef | null {
  const pull = header.pullRequest;
  return pull ? githubUser(pull.author?.login ?? 'ghost', pull.author?.avatarUrl) : null;
}

/**
 * A stack entry known only from what the stack lists about it, in the viewed PR's repository. The listing names nobody,
 * so who opened it is unknown until its own page header says.
 */
function stackNeighbour(
  current: PrSummary,
  known: Pick<StackEntry, 'number' | 'title' | 'url' | 'state' | 'isDraft' | 'headRefName' | 'baseRefName' | 'parentNumber' | 'mergeStatus' | 'nativeStack' | 'readyToMergeAsStack'>,
): StackEntry {
  return {
    ...known,
    id: `${current.repo.owner}/${current.repo.name}#${known.number}`,
    repo: current.repo,
    author: null,
    createdAt: '',
    updatedAt: '',
    mergedAt: null,
    reviewDecision: 'NONE',
    reviewers: [],
    ci: { state: 'NONE', checks: [], counts: { success: 0, failure: 0, pending: 0, other: 0 } },
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    labels: [],
    commentCount: 0,
    unread: null,
    isInMergeQueue: false,
    autoMerge: null,
    conversations: null,
  };
}

/**
 * The entries, each but the viewed PR with its conversations and, where the stack's listing did not say, who opened it,
 * three entries at a time; the page counts the viewed PR's conversations from the threads it shows. An entry the listing
 * names by its number alone (Graphite's comment links a fork plainly, `#9003`) takes its title and state from the same
 * header, which gives the state as the PR's own page does (OPEN, DRAFT, MERGED or CLOSED); one it named with a title and
 * an icon keeps them.
 */
function withConversationsAndAuthors(
  entries: StackEntry[],
  current: Pick<PrSummary, 'number'>,
  lookups: { conversations(number: number): Promise<PrSummary['conversations']>; header(number: number): Promise<AuthorHeaderAnswer | null> },
): Promise<StackEntry[]> {
  return politely(entries, 3, async (entry): Promise<StackEntry> => {
    if (entry.number === current.number) return entry;
    const [conversations, header] = await Promise.all([lookups.conversations(entry.number), entry.author ? null : lookups.header(entry.number)]);
    const unnamed = entry.title === `#${entry.number}`;
    const state = header?.pullRequest?.state;
    return {
      ...entry,
      conversations,
      author: entry.author ?? (header && authorIn(header)),
      ...(unnamed && header?.pullRequest?.title && { title: header.pullRequest.title }),
      ...(unnamed && (state === 'MERGED' || state === 'CLOSED') && { state, isDraft: false }),
      ...(unnamed && (state === 'OPEN' || state === 'DRAFT') && { state: 'OPEN', isDraft: state === 'DRAFT' }),
    };
  });
}

/**
 * page_data/stack_mergeability (the fields read here): GitHub's verdict on one PR of a native stack, asked of that PR's
 * own page data, `{ state, effectiveEntryStatus, isInAutoMergeRange, channels, statusCheckChannels }` (verified signed in,
 * 2026-10-15). `effectiveEntryStatus` is READY when GitHub can merge the PR with the open ones below it; GitHub's bundle
 * names the others (NOT_READY, BLOCKED_DOWNSTACK, DRAFT, CLOSED, MERGE_CONFLICTS, NEEDS_REBASE, MERGED, …), each read
 * here as not ready, as is an answer without one, which GitHub's own page reads as NOT_READY. `state` is the PR's merge
 * requirements' state, as its merge box names it (MERGEABLE, MERGEABLE_IF_STATUSES_PASS, UNMERGEABLE, UNKNOWN).
 */
export const stackMergeabilityAnswer = z.object({ state: z.nullish(z.string()), effectiveEntryStatus: z.nullish(z.string()) });

type StackMergeabilityAnswer = z.infer<typeof stackMergeabilityAnswer>;

/**
 * page_data/header, for who opened the PR and its title and state (the fields read here). Its `pullRequest` carries the
 * fields of the page's own `pullRequestsLayoutRoute.pullRequest` (docs/research/github-web-endpoints.md), whose `state` is
 * OPEN, DRAFT, MERGED or CLOSED; `title` is read by that same name and stays unread where GitHub leaves it out.
 */
export const authorHeaderAnswer = z.object({
  pullRequest: z.nullish(
    z.object({
      author: z.nullish(z.object({ login: z.nullish(z.string()), avatarUrl: z.nullish(z.string()) })),
      title: z.nullish(z.string()),
      state: z.nullish(z.string()),
    }),
  ),
});

type AuthorHeaderAnswer = z.infer<typeof authorHeaderAnswer>;

/** `pullRequestsLayoutRoute.stack` (observed): pulls listed top of the stack first. */
export const nativeStackSchema = z.object({
  baseBranch: z.string(),
  position: z.number(),
  size: z.number(),
  pulls: z.array(z.object({ number: z.number(), title: z.string(), state: z.string(), url: z.string(), headBranch: z.string(), headOid: z.nullish(z.string()) })),
});

export type NativeStack = z.infer<typeof nativeStackSchema>;

interface GraphiteEntry {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  /** The entry it is stacked on, as the comment's order or the item naming it says; null on trunk. */
  parentNumber: number | null;
}

/**
 * What Graphite's comment says of the PR a link of it names: the title its reference gives (without the `#n` GitHub adds),
 * else its number, its address, and its state by the icon GitHub rendered for it, open where there is none.
 */
function pullNamedBy(link: Element | undefined, number: number, icon: Element | null): Omit<GraphiteEntry, 'parentNumber'> {
  const title = link?.cloneNode(true);
  if (title instanceof Element) title.querySelector('.issue-shorthand')?.remove();
  const state = icon?.getAttribute('class') ?? '';
  return {
    number,
    title: title?.textContent?.trim() || `#${number}`,
    url: link ? new URL(link.getAttribute('href') ?? '', 'https://github.com').href : '',
    state: state.includes('octicon-git-merge') ? 'MERGED' : state.includes('octicon-git-pull-request-closed') ? 'CLOSED' : 'OPEN',
    isDraft: state.includes('octicon-git-pull-request-draft'),
  };
}
