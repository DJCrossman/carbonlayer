// Where the PR sits in its stack: GitHub's native stack (from the PR page's layout data) first, else the
// stack Graphite lists in its PR comment, else the PR alone.

import type { PrSummary, Stack } from '../model';
import { findInPayload, noteShape } from './session';

export async function resolveStack(
  subject: { current: PrSummary; nativeStack: NativeStack | null; page: Document },
  lookups: {
    /** page_data/stack_mergeability: each stack entry's merge status; null when GitHub did not answer. */
    mergeability(): Promise<unknown>;
    /** The author's open PRs in this repository, for the Graphite comment's entries; empty when GitHub did not answer. */
    authorsOpenPulls(): Promise<PrSummary[]>;
  },
): Promise<Stack> {
  const { current, nativeStack } = subject;

  if (nativeStack && nativeStack.pulls.length > 0) {
    const statuses = await lookups.mergeability();
    noteShape('page_data/stack_mergeability', statuses);
    const rows = (Array.isArray(statuses) ? statuses : findInPayload(statuses, (_, value) => Array.isArray(value) && value.some((row) => !!row?.pull))) as
      | Array<{ pull?: { number?: number }; status?: string }>
      | undefined;
    const statusByNumber = new Map((rows ?? []).map((row) => [row.pull?.number, row.status?.toUpperCase()]));
    // GitHub lists the top of the stack first; position 1 is the PR closest to trunk.
    const bottomFirst = [...nativeStack.pulls].reverse();
    const entries = bottomFirst.map((pull, index) =>
      pull.number === current.number
        ? current
        : stackNeighbour(current, {
            number: pull.number,
            title: pull.title,
            url: new URL(pull.url, 'https://github.com').href,
            state: pull.state === 'MERGED' || pull.state === 'CLOSED' ? pull.state : 'OPEN',
            isDraft: pull.state === 'DRAFT',
            headRefName: pull.headBranch,
            baseRefName: index === 0 ? nativeStack.baseBranch : bottomFirst[index - 1]!.headBranch,
            mergeStatus: pull.state === 'DRAFT' ? 'DRAFT' : ['MERGEABLE', 'CLEAN'].includes(statusByNumber.get(pull.number) ?? '') ? 'CLEAN' : 'UNKNOWN',
            nativeStack: { position: index + 1, size: nativeStack.size },
          }),
    );
    return { entries, currentIndex: entries.indexOf(current), trunk: nativeStack.baseBranch, source: 'native' };
  }

  const comment = graphiteStackComment(subject.page);
  if (comment && comment.entries.length > 1 && comment.entries.some((entry) => entry.number === current.number)) {
    const open = new Map((await lookups.authorsOpenPulls()).map((pull) => [pull.number, pull]));
    // At most 25 entries, centred on the PR being viewed.
    const index = comment.entries.findIndex((entry) => entry.number === current.number);
    const start = Math.max(0, Math.min(index - 12, comment.entries.length - 25));
    const entries = comment.entries.slice(start, start + 25).map((entry) =>
      entry.number === current.number
        ? current
        : (open.get(entry.number) ??
          stackNeighbour(current, { ...entry, headRefName: '', baseRefName: '', mergeStatus: entry.isDraft ? 'DRAFT' : 'UNKNOWN', nativeStack: null })),
    );
    return { entries, currentIndex: entries.indexOf(current), trunk: comment.trunk ?? current.baseRefName, source: 'graphite-comment' };
  }

  return { entries: [current], currentIndex: 0, trunk: current.baseRefName, source: 'none' };
}

/**
 * The stack Graphite's PR comment lists, bottom (closest to trunk) first, or null when the conversation has no
 * such comment. GitHub renders each `* **#123**` line as a reference link with the PR's title and a state icon,
 * and the trunk as `* \`main\``.
 */
export function graphiteStackComment(page: Document): { entries: GraphiteEntry[]; trunk: string | null } | null {
  const body = [...page.querySelectorAll('.timeline-comment-group[id^="issuecomment-"] .comment-body')].find((element) =>
    element.textContent?.includes('This stack of pull requests is managed by'),
  );
  if (!body) return null;
  const entries: GraphiteEntry[] = [];
  let trunk: string | null = null;
  for (const item of body.querySelectorAll('li')) {
    const link = item.querySelector('a[href*="/pull/"]');
    const number = Number(/\/pull\/(\d+)/.exec(link?.getAttribute('href') ?? '')?.[1] ?? /#(\d+)/.exec(item.textContent ?? '')?.[1]);
    if (number) {
      const title = link?.cloneNode(true) as Element | undefined;
      title?.querySelector('.issue-shorthand')?.remove();
      const icon = item.querySelector('svg.octicon')?.getAttribute('class') ?? '';
      entries.push({
        number,
        title: title?.textContent?.trim() || `#${number}`,
        url: link ? new URL(link.getAttribute('href') ?? '', 'https://github.com').href : '',
        state: icon.includes('octicon-git-merge') ? 'MERGED' : icon.includes('octicon-git-pull-request-closed') ? 'CLOSED' : 'OPEN',
        isDraft: icon.includes('octicon-git-pull-request-draft'),
      });
    } else if (item.querySelector(':scope > code')) {
      trunk = item.querySelector(':scope > code')?.textContent?.trim() ?? null;
    }
  }
  return entries.length > 0 ? { entries: entries.reverse(), trunk } : null;
}

/** A stack entry known only from what the stack lists about it; author and repository are the viewed PR's. */
function stackNeighbour(
  current: PrSummary,
  known: Pick<PrSummary, 'number' | 'title' | 'url' | 'state' | 'isDraft' | 'headRefName' | 'baseRefName' | 'mergeStatus' | 'nativeStack'>,
): PrSummary {
  return {
    ...known,
    id: `${current.repo.owner}/${current.repo.name}#${known.number}`,
    repo: current.repo,
    author: current.author,
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
  };
}

/** `pullRequestsLayoutRoute.stack` (observed): pulls listed top of the stack first. */
export interface NativeStack {
  baseBranch: string;
  position: number;
  size: number;
  pulls: Array<{ number: number; title: string; state: string; url: string; headBranch: string; headOid?: string }>;
}

interface GraphiteEntry {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
}
