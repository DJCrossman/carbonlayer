// What merging a GitHub-native stack in the background waits on (src/lib/stack-merges.ts), read with the PR page's own
// readers (pr-stages.ts): each merged PR's header (its state and head commit) and checks stages, GitHub's dynamic workflow
// runs included, its own page_data/stack_mergeability, and the merge box stage of the PR the stack merges from.

import type { RepoRef, StackReadiness } from '../model';
import { getSettings } from '../settings';
import { fetchPrStage } from './pr-stages';
import { getJson, politely } from './session';
import { stackMergeabilityAnswer } from './stack';

/** For `prs`, the PRs merging the stack from `number` merges, bottom first. */
export async function stackReadiness({ repo, number, prs }: { repo: RepoRef; number: number; prs: number[] }): Promise<StackReadiness> {
  // The merge method the PR page asks GitHub's verdicts for.
  const { mergeMethod } = await getSettings();
  const [mergeBox, each] = await Promise.all([
    fetchPrStage('mergeBox', { repo, number }),
    // Three PRs at a time; the stages of one PR share its page while they are on their way.
    politely(prs, 3, async (pr) => {
      const [header, checks, verdict] = await Promise.all([
        fetchPrStage('header', { repo, number: pr }),
        fetchPrStage('checks', { repo, number: pr }),
        getJson(`/${repo.owner}/${repo.name}/pull/${pr}/page_data/stack_mergeability?merge_method=${mergeMethod}&bypass_requirements=false`, stackMergeabilityAnswer),
      ]);
      return {
        number: pr,
        state: header.state,
        headOid: header.headOid,
        ci: checks.ci,
        requiredCheckNames: checks.requiredCheckNames,
        verdict: { status: verdict.effectiveEntryStatus ?? null, mergeState: verdict.state ?? null },
      };
    }),
  ]);
  return { mergeStatus: mergeBox.mergeStatus, stackSection: mergeBox.stackSection, prs: each };
}
