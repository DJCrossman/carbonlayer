// "Group by stack" in the inbox. A stack, Graphite's or GitHub's own, is a chain of branches in one repository: a PR whose
// base branch is another open PR's head branch sits on top of it. GitHub's dashboard rows name no branches; the inbox
// looks an open row's up (its page header; its merge box, once enriched, has the last word), so a row stands alone until
// then.
import type { PrSummary } from '../lib/model';

/**
 * A section's rows, in its order, with each stack's together: the stack where the first of its rows sorts, its top (the
 * row furthest from trunk) first and the others below it, top down, `stacked`. A row's place in its stack is the one
 * `stackPlaces` found among every row the inbox has, so a stack joins through a PR another section shows.
 */
export function rowsByStack(prs: PrSummary[], places: ReadonlyMap<string, StackPlace>): Array<{ pr: PrSummary; stacked: boolean }> {
  // Each stack's rows by the PR at its bottom (a row in no stack is its own). Groups keep the order their first rows
  // came in.
  const stacks = new Map<string, Array<{ pr: PrSummary; position: number }>>();
  for (const pr of prs) {
    const place = places.get(pr.id);
    const bottomId = place?.bottomId ?? pr.id;
    const stack = stacks.get(bottomId) ?? [];
    stack.push({ pr, position: place?.position ?? 1 });
    stacks.set(bottomId, stack);
  }

  return [...stacks.values()].flatMap((stack) => stack.toSorted((a, b) => b.position - a.position).map(({ pr }, index) => ({ pr, stacked: index > 0 })));
}

/** Where a row sits in its stack, among the pull requests the inbox knows. */
export interface StackPlace {
  /** The stack's bottom-most known PR, the same for each of its rows. */
  bottomId: string;
  /** Counted from the bottom, as GitHub counts: the bottom-most known PR is 1. */
  position: number;
  /**
   * How many known PRs the row's own line of the stack has, as Graphite counts: those below it down to the bottom, the
   * row, and the tallest line above it. A fork's other branches are not counted.
   */
  size: number;
  /** GitHub doesn't track the row's stack (the row has no native stack): its place is worked out from branch names alone. */
  untracked: boolean;
}

/**
 * Where each of `known`'s rows sits in its stack, by PR id: only rows in a stack of two or more, so a row on nothing
 * known, or whose branches are not known yet, has no place.
 */
export function stackPlaces(known: PrSummary[]): Map<string, StackPlace> {
  // The PR whose head is each branch, by `owner/name:branch`; the first known wins.
  const byHead = new Map<string, PrSummary>();
  for (const pr of known) {
    const branch = `${pr.repo.owner.toLowerCase()}/${pr.repo.name.toLowerCase()}:${pr.headRefName}`;
    if (pr.headRefName && !byHead.has(branch)) byHead.set(branch, pr);
  }

  // Each row's bottom (a row on nothing known, or not looked up yet, is its own) and its height, the steps down to that
  // bottom; a PR two sections show counts once. Walking down also tells each PR passed how tall a line stands on it.
  const chains = new Map<string, { pr: PrSummary; bottomId: string; height: number }>();
  const tallestAbove = new Map<string, number>();
  for (const pr of known) {
    if (chains.has(pr.id)) continue;
    let bottom = pr;
    let height = 0;
    if (pr.headRefName && pr.baseRefName) {
      const repository = `${pr.repo.owner.toLowerCase()}/${pr.repo.name.toLowerCase()}`;
      // A chain that comes back on itself stops before it repeats.
      const seen = new Set([pr.id]);
      let below = byHead.get(`${repository}:${pr.baseRefName}`);
      while (below && !seen.has(below.id)) {
        seen.add(below.id);
        bottom = below;
        height += 1;
        tallestAbove.set(below.id, Math.max(tallestAbove.get(below.id) ?? 0, height));
        below = byHead.get(`${repository}:${below.baseRefName}`);
      }
    }
    chains.set(pr.id, { pr, bottomId: bottom.id, height });
  }

  const places = new Map<string, StackPlace>();
  for (const [id, { pr, bottomId, height }] of chains) {
    const size = height + 1 + (tallestAbove.get(id) ?? 0);
    if (size > 1) places.set(id, { bottomId, position: height + 1, size, untracked: pr.nativeStack === null });
  }
  return places;
}
