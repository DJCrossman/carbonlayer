// Where a PR sits in its stack. GitHub-native stacks first; otherwise walk the branches (a PR's base is
// the head of the PR below it); otherwise Graphite's stack comment; otherwise the PR stands alone.
// See docs/research/github-api.md §5.

import type { PrSummary, RepoRef, Stack } from '../model';
import { graphql } from './client';
import { summarisePullRequest } from './inbox';
import { NATIVE_STACK, OPEN_PULL_REQUESTS_ONTO, PULL_REQUESTS_WITH_HEAD, pullRequestsByNumberQuery, type PullRequestCard } from './queries';

/** Resolves the stack around `pr.summary`. `lookups` does the fetching so tests can feed canned data. */
export async function resolveStack(pr: StackSubject, lookups: StackLookups): Promise<Stack> {
  const self = pr.summary;

  if (self.nativeStack) {
    const native = await lookups.nativeStack();
    const currentIndex = native?.entries.findIndex((entry) => entry.number === self.number) ?? -1;
    if (native && currentIndex >= 0) return { entries: native.entries, currentIndex, trunk: native.trunk, source: 'native' };
  }

  // A fork's branch names say nothing about the base repository's branches.
  if (!pr.isCrossRepository) {
    const [below, above] = await Promise.all([pullRequestsBelow(self, pr.defaultBranch, lookups), pullRequestsAbove(self, pr.defaultBranch, lookups)]);
    if (below.length > 0 || above.length > 0) {
      const order = [...below.map((entry) => entry.number).reverse(), self.number, ...above.map((entry) => entry.number)];
      const entries = await stackEntries(order, self, lookups);
      return { entries, currentIndex: entries.indexOf(self), trunk: below.at(-1)?.baseRefName ?? self.baseRefName, source: 'branches' };
    }
  }

  const comment = pr.texts.map(stackFromGraphiteComment).find((parsed) => parsed && parsed.numbers.length > 1 && parsed.numbers.includes(self.number));
  if (comment) {
    // Keep at most 25 entries, centred on the PR being viewed.
    const index = comment.numbers.indexOf(self.number);
    const start = Math.max(0, Math.min(index - 12, comment.numbers.length - 25));
    const entries = await stackEntries(comment.numbers.slice(start, start + 25), self, lookups);
    return { entries, currentIndex: entries.indexOf(self), trunk: comment.trunk ?? entries[0]?.baseRefName ?? self.baseRefName, source: 'graphite-comment' };
  }

  return { entries: [self], currentIndex: 0, trunk: self.baseRefName, source: 'none' };
}

/** Lookups against the GitHub API for the PR `number` in `repo`. */
export function githubStackLookups(token: string, repo: RepoRef, number: number): StackLookups {
  const variables = { owner: repo.owner, name: repo.name };
  return {
    async nativeStack() {
      const data = await graphql<NativeStackResponse>(token, NATIVE_STACK, { ...variables, number });
      const stack = data.repository?.pullRequest?.stack;
      if (!stack) return null;
      const entries = stack.entries.nodes
        .flatMap((entry) => (entry?.pullRequest ? [{ position: entry.position, pullRequest: entry.pullRequest }] : []))
        .sort((a, b) => a.position - b.position)
        .map((entry) => summarisePullRequest(entry.pullRequest));
      return { trunk: stack.baseRefName, entries };
    },
    async pullRequestsWithHead(branch) {
      const data = await graphql<BranchPullRequestsResponse>(token, PULL_REQUESTS_WITH_HEAD, { ...variables, branch });
      return data.repository?.pullRequests.nodes ?? [];
    },
    async openPullRequestsOnto(branch) {
      const data = await graphql<BranchPullRequestsResponse>(token, OPEN_PULL_REQUESTS_ONTO, { ...variables, branch });
      return data.repository?.pullRequests.nodes ?? [];
    },
    async summaries(numbers) {
      if (numbers.length === 0) return [];
      const data = await graphql<{ repository: Record<string, PullRequestCard | null> | null }>(token, pullRequestsByNumberQuery(numbers), variables);
      return numbers.flatMap((_, i) => {
        const card = data.repository?.[`p${i}`];
        return card ? [summarisePullRequest(card)] : [];
      });
    },
  };
}

/**
 * The stack Graphite's PR comment describes, bottom (closest to trunk) first, or null when `text` is not
 * that comment. The comment lists PRs top-down as `* **#123** …` lines and the trunk as `` * `main` ``.
 */
export function stackFromGraphiteComment(text: string): { numbers: number[]; trunk: string | null } | null {
  if (!text.includes('This stack of pull requests is managed by') && !text.includes('<!-- Current dependencies on/for this PR: -->')) return null;
  const numbers = [...text.matchAll(/^\* \*\*#(\d+)\*\*/gm)].map((match) => Number(match[1])).reverse();
  if (numbers.length === 0) return null;
  return { numbers, trunk: /^\* `([^`]+)`\s*$/m.exec(text)?.[1] ?? null };
}

/** PRs below `self`, closest first: follow each base branch to the PR whose head it is, until trunk. */
async function pullRequestsBelow(self: PrSummary, defaultBranch: string, lookups: StackLookups): Promise<BranchPullRequest[]> {
  const below: BranchPullRequest[] = [];
  const seen = new Set([self.number]);
  let base = self.baseRefName;
  while (base !== defaultBranch && below.length < 10) {
    const candidates = (await lookups.pullRequestsWithHead(base))
      .filter((candidate) => !seen.has(candidate.number) && !candidate.isCrossRepository)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // An open PR is the live parent; a merged one is a parent that already landed.
    const parent = candidates.find((candidate) => candidate.state === 'OPEN') ?? candidates.find((candidate) => candidate.state === 'MERGED');
    if (!parent) break;
    below.push(parent);
    seen.add(parent.number);
    base = parent.baseRefName;
  }
  return below;
}

/** Open PRs above `self`, closest first. Where the stack branches, follow the most recently updated child and stop. */
async function pullRequestsAbove(self: PrSummary, defaultBranch: string, lookups: StackLookups): Promise<BranchPullRequest[]> {
  const above: BranchPullRequest[] = [];
  const seen = new Set([self.number]);
  let head = self.headRefName;
  // Every PR targets trunk, so a PR whose head is trunk has no meaningful children; 14 above + 10 below + self = 25.
  while (head !== defaultBranch && above.length < 14) {
    const children = (await lookups.openPullRequestsOnto(head))
      .filter((child) => !seen.has(child.number) && !child.isCrossRepository)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const child = children[0];
    if (!child) break;
    above.push(child);
    seen.add(child.number);
    head = child.headRefName;
    if (children.length > 1) break;
  }
  return above;
}

/** The stack's PRs in `order` (PR numbers, bottom first), reusing `self` and fetching the others in one request. */
async function stackEntries(order: number[], self: PrSummary, lookups: StackLookups): Promise<PrSummary[]> {
  const others = await lookups.summaries(order.filter((number) => number !== self.number));
  const byNumber = new Map(others.map((summary) => [summary.number, summary]));
  byNumber.set(self.number, self);
  return order.flatMap((number) => byNumber.get(number) ?? []);
}

export interface StackSubject {
  summary: PrSummary;
  /** The repository's default branch, where the walk down stops. */
  defaultBranch: string;
  isCrossRepository: boolean;
  /** The PR body and comment bodies, searched for Graphite's stack comment. */
  texts: string[];
}

export interface StackLookups {
  /** The native stack ordered by position with the branch it targets, or null when GitHub has none. */
  nativeStack(): Promise<{ trunk: string; entries: PrSummary[] } | null>;
  /** Open and merged PRs whose head branch is `branch`. */
  pullRequestsWithHead(branch: string): Promise<BranchPullRequest[]>;
  /** Open PRs whose base branch is `branch`. */
  openPullRequestsOnto(branch: string): Promise<BranchPullRequest[]>;
  /** Summaries of these PRs in the same order, skipping any that cannot be loaded. */
  summaries(numbers: number[]): Promise<PrSummary[]>;
}

export interface BranchPullRequest {
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
  isCrossRepository: boolean;
}

interface NativeStackResponse {
  repository: {
    pullRequest: {
      stack: { baseRefName: string; entries: { nodes: Array<{ position: number; pullRequest: PullRequestCard | null } | null> } } | null;
    } | null;
  } | null;
}

interface BranchPullRequestsResponse {
  repository: { pullRequests: { nodes: BranchPullRequest[] } } | null;
}
