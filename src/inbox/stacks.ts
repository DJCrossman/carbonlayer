// "Group by stack" in the inbox. A stack, Graphite's or GitHub's own, is a chain of branches in one repository: a PR whose
// base branch is another open PR's head branch sits on top of it. GitHub's dashboard rows name no branches; an open
// row's enrichment does (its merge box), so a row stands alone until then.
import type { PrSummary } from '../lib/model';

/**
 * A section's rows, in its order, with each stack's together: the stack where the first of its rows sorts, its top (the
 * row furthest from trunk) first and the others below it, top down, `stacked`. A row's place in its stack is found among
 * `known`, every row the inbox has, so a stack joins through a PR another section shows.
 */
export function rowsByStack(prs: PrSummary[], known: PrSummary[]): Array<{ pr: PrSummary; stacked: boolean }> {
  // The PR whose head is each branch, by `owner/name:branch`; the first known wins.
  const byHead = new Map<string, PrSummary>();
  for (const pr of known) {
    const branch = `${pr.repo.owner.toLowerCase()}/${pr.repo.name.toLowerCase()}:${pr.headRefName}`;
    if (pr.headRefName && !byHead.has(branch)) byHead.set(branch, pr);
  }

  // Each stack's rows by the PR at its bottom (a row on nothing known, or not enriched yet, is its own), each with its
  // height, the steps down to that bottom. Groups keep the order their first rows came in.
  const stacks = new Map<string, Array<{ pr: PrSummary; height: number }>>();
  for (const pr of prs) {
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
        below = byHead.get(`${repository}:${below.baseRefName}`);
      }
    }
    const stack = stacks.get(bottom.id) ?? [];
    stack.push({ pr, height });
    stacks.set(bottom.id, stack);
  }

  return [...stacks.values()].flatMap((stack) => stack.toSorted((a, b) => b.height - a.height).map(({ pr }, index) => ({ pr, stacked: index > 0 })));
}
