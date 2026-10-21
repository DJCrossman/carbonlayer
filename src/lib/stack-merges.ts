// Merging a GitHub-native stack the way Graphite's dialog does, with its "Always rebase branches before merge" and "Ignore
// optional CI status checks during merge process", in the background service worker (entrypoints/background.ts), so it
// carries on when the PR's tab closes. GitHub rebases a stack in one request (`pr.rebaseStack`) and merges it in another
// (`pr.merge`, enqueue_stack DIRECT_MERGE from the PR at its top), but waits for nothing short of auto-merge: here,
// CarbonLayer waits. The same runner merges a stack when it is ready ("Merge when ready", a stack merge `whenReady`) where
// GitHub refuses its own stack auto-merge to the repository (mergeStackWhenReady): that one waits as long as it takes,
// through whatever its author can still fix. A stack merge lives in storage.local (STACK_MERGES), so a restarted worker or
// browser carries on with it, and moves a step at a time (advanceStackMerge), asking GitHub through a github.com tab's
// content script.

import { z } from 'zod/mini';
import { mergeMethodSchema, repoRefSchema, type StackReadiness } from './model';
import { mergeCommit, type MergeMethod, type RpcMethod, type RpcMethods } from './rpc';

/** Where the stack merges are kept in storage.local: those under way, and those that stopped until they are dismissed. */
export const STACK_MERGES = 'stackMerges';

/**
 * The stack merge one step on, from what GitHub says now: started, it looks at the stack and rebases it first when asked
 * to and GitHub says it needs it; then it waits until nothing stands in the way (whatTheStackWaitsFor), merges, and
 * follows the merge until GitHub says it is done. GitHub's refusal of a rebase or a merge stops it, in GitHub's words; a
 * request that could not reach GitHub, or a read that failed, leaves it where it was, saying why (`trouble`), for the
 * next step to try again. Six hours after it started, a merge still waiting stops; one merging when ready has no time cap,
 * and looks at the stack less often the longer it has waited unchanged. A step with nothing to do yet returns `merge`
 * itself.
 */
export async function advanceStackMerge(merge: StackMerge, github: GitHubThroughATab, now: number): Promise<StackMerge> {
  const { step } = merge;
  const pull = { repo: merge.repo, number: merge.number };
  const stop = (reason: string): StackMerge => ({ ...merge, trouble: null, step: { kind: 'stopped', reason } });
  if (!merge.whenReady && (step.kind === 'starting' || step.kind === 'rebasing' || step.kind === 'waiting') && now - merge.startedAt > 6 * 60 * 60_000) {
    return stop('CarbonLayer stopped waiting after 6 hours: the stack still could not merge.');
  }
  // What GitHub says of the stack now decides: merge, rebase, wait or stop. The heads the merge merges are those it saw
  // first (and again after its own rebase); any other means someone pushed. Merging when ready waits through new commits,
  // so it merges the heads it saw last.
  const decide = (readiness: StackReadiness, rebase: boolean): StackMerge => {
    const seen = Object.fromEntries(readiness.prs.map((pr) => [String(pr.number), pr.headOid]));
    const heads = merge.whenReady ? seen : (merge.heads ?? seen);
    const waitsFor = whatTheStackWaitsFor(readiness, { heads, ignoreOptionalChecks: merge.ignoreOptionalChecks, rebase, whenReady: merge.whenReady });
    switch (waitsFor.kind) {
      case 'stop':
        return stop(waitsFor.reason);
      case 'rebase':
        return { ...merge, trouble: null, step: { kind: 'rebasing', sent: false } };
      case 'merge':
        return { ...merge, heads, trouble: null, step: { kind: 'merging', sentAt: null } };
      default: {
        if (!merge.whenReady) return { ...merge, heads, trouble: null, step: { kind: 'waiting', for: waitsFor } };
        // Since when the stack has waited for the same thing at the same heads, which paces the next look (below).
        const unchangedSince =
          step.kind === 'waiting' && JSON.stringify(step.for) === JSON.stringify(waitsFor) && JSON.stringify(merge.heads) === JSON.stringify(heads) ? step.unchangedSince : undefined;
        return { ...merge, heads, trouble: null, step: { kind: 'waiting', for: waitsFor, lookedAt: now, unchangedSince: unchangedSince ?? now } };
      }
    }
  };
  // A rebase or a merge GitHub refused stops the merge, in its words. One that never reached a tab is sent again next
  // time; one whose tab went away before it answered may have reached GitHub, so from then on GitHub's state says.
  try {
    switch (step.kind) {
      case 'starting': {
        const readiness = await github.ask('pr.fetchStackReadiness', { ...pull, prs: merge.prs.map((pr) => pr.number) });
        // As `pr.merge` does: nothing newer than what the viewer saw is rebased or merged. Merging when ready waits through
        // new commits.
        if (!merge.whenReady && readiness.prs.find((pr) => pr.number === merge.number)?.headOid !== merge.expectedHeadOid) {
          return stop('New commits were pushed since this page loaded. Reload and review them before merging.');
        }
        return decide(readiness, merge.rebaseFirst);
      }
      case 'rebasing': {
        // The tab's content script writes only to a PR whose page it has loaded; the page names its id too.
        const { id } = await github.ask('pr.fetchHeader', pull);
        try {
          const { complete } = await github.ask(step.sent ? 'pr.followStackRebase' : 'pr.rebaseStack', { prId: id });
          // Rebased, every branch has a new head, and the checks start over: the next look sees them.
          return complete ? { ...merge, heads: null, trouble: null, step: { kind: 'waiting', for: null } } : { ...merge, trouble: null, step: { kind: 'rebasing', sent: true } };
        } catch (error) {
          if (!(error instanceof UnansweredRequest)) return stop(error instanceof Error ? error.message : String(error));
          return { ...merge, trouble: error.message, step: { kind: 'rebasing', sent: step.sent || error.reachedTab } };
        }
      }
      case 'waiting': {
        // Merging when ready may wait for days, for a review say, so it looks again after a quarter of the time the stack
        // has waited unchanged, from 30 s (every alarm) up to 5 minutes: checks that just started are looked at every 30 s
        // while they run, a review that comes after a day is merged within 5 minutes, and an idle stack costs a look (and,
        // with no github.com tab open, a background tab for as long as the look takes) every 5 minutes. The alarm comes
        // every 30 s, give or take: a look due within 5 s is taken now.
        if (merge.whenReady && step.lookedAt !== undefined) {
          const waited = step.lookedAt - (step.unchangedSince ?? step.lookedAt);
          if (now - step.lookedAt + 5_000 < Math.min(5 * 60_000, Math.max(30_000, waited / 4))) return merge;
        }
        return decide(await github.ask('pr.fetchStackReadiness', { ...pull, prs: merge.prs.map((pr) => pr.number) }), false);
      }
      case 'merging': {
        const header = await github.ask('pr.fetchHeader', pull);
        if (header.state === 'MERGED') return { ...merge, trouble: null, step: { kind: 'merged' } };
        if (step.sentAt === null) {
          // GitHub's merge has no head guard; `pr.merge` checks the head is still the one waited for.
          const expectedHeadOid = merge.heads?.[String(merge.number)] ?? merge.expectedHeadOid;
          try {
            await github.ask('pr.merge', { prId: header.id, method: merge.method, expectedHeadOid, ...(merge.commit && { commit: merge.commit }) });
          } catch (error) {
            if (!(error instanceof UnansweredRequest)) {
              // Pushed to since it looked, merging when ready looks at the stack again: only GitHub's own refusal stops it.
              if (merge.whenReady && (await github.ask('pr.fetchHeader', pull)).headOid !== expectedHeadOid) return { ...merge, trouble: null, step: { kind: 'waiting', for: null } };
              return stop(error instanceof Error ? error.message : String(error));
            }
            return { ...merge, trouble: error.message, step: error.reachedTab ? { kind: 'merging', sentAt: now } : step };
          }
          const after = await github.ask('pr.fetchHeader', pull);
          return { ...merge, trouble: null, step: after.state === 'MERGED' ? { kind: 'merged' } : { kind: 'merging', sentAt: now } };
        }
        // GitHub merges a stack in moments, or says why it cannot; ten minutes without either needs a person.
        if (now - step.sentAt > 10 * 60_000) return stop('GitHub had not merged the stack 10 minutes after CarbonLayer asked it to. See the pull request on GitHub.');
        return { ...merge, trouble: null };
      }
      case 'merged':
      case 'stopped':
        return merge;
    }
  } catch (error) {
    return { ...merge, trouble: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * What stands between the stack and its merge, first things first: a PR merged or closed meanwhile, or pushed to since
 * the merge started (`heads`), and what GitHub's merge box says of the stack's branches (conflicts; a rebase, which is
 * done when `rebase` is asked for, and stops the merge where GitHub requires one); then the checks of every PR: each
 * required one must pass, and unless optional ones are ignored, every other one must finish successfully too (success,
 * neutral or skipped); a failure stops the merge. Last, GitHub must say each PR can merge with those below it (its
 * verdict READY, its merge requirements MERGEABLE). Nothing in the way: merge.
 * Merging when ready (`whenReady`) waits through what the stack's author can still fix: a failing check (until it passes,
 * run again or after a push), new commits, and a stack GitHub says must be rebased (until someone rebases it); it merges
 * the PRs still open, whichever merged meanwhile, and only a closed PR and conflicts stop it.
 */
export function whatTheStackWaitsFor(
  readiness: StackReadiness,
  { heads, ignoreOptionalChecks, rebase, whenReady }: { heads: Record<string, string>; ignoreOptionalChecks: boolean; rebase: boolean; whenReady: boolean },
): StackWait | { kind: 'merge' } | { kind: 'rebase' } | { kind: 'stop'; reason: string } {
  const prs = whenReady ? readiness.prs.filter((pr) => pr.state !== 'MERGED') : readiness.prs;
  const gone = prs.find((pr) => pr.state !== 'OPEN');
  if (gone) return { kind: 'stop', reason: `#${gone.number} was ${gone.state === 'MERGED' ? 'merged' : 'closed'} meanwhile.` };
  const pushedTo = whenReady ? undefined : prs.find((pr) => (heads[String(pr.number)] ?? pr.headOid) !== pr.headOid);
  if (pushedTo) return { kind: 'stop', reason: `New commits were pushed to #${pushedTo.number} since the merge started. Review them, then merge again.` };
  // GitHub's merge box sections about the stack's branches, in its words.
  const section = readiness.stackSection?.kind;
  if (section === 'current-conflicts' || readiness.mergeStatus === 'DIRTY') return { kind: 'stop', reason: 'This branch has conflicts that must be resolved' };
  if (section === 'conflicts') return { kind: 'stop', reason: 'This stack has conflicts that must be resolved' };
  if (rebase && (section === 'rebase-required' || section === 'rebase-optional')) return { kind: 'rebase' };
  if (section === 'rebase-required') return whenReady ? { kind: 'stack-rebase' } : { kind: 'stop', reason: 'Some branches in this stack have diverged and must be rebased' };

  let requiredPassed = 0;
  let required = 0;
  let optionalRunning = 0;
  for (const pr of prs) {
    for (const check of pr.ci.checks) {
      const isRequired = pr.requiredCheckNames.includes(check.name);
      const succeeded = check.state === 'SUCCESS' || check.state === 'NEUTRAL' || check.state === 'SKIPPED';
      const failed = check.state === 'FAILURE' || check.state === 'CANCELLED';
      if (failed && (isRequired || !ignoreOptionalChecks) && !whenReady) {
        const what = `${isRequired ? 'Required' : 'Optional'} check "${check.name}" on #${pr.number} ${check.state === 'CANCELLED' ? 'was cancelled' : 'failed'}`;
        return { kind: 'stop', reason: check.description ? `${what}: ${check.description}` : what };
      }
      if (isRequired) {
        required += 1;
        if (succeeded) requiredPassed += 1;
      } else if (!succeeded && !failed && !ignoreOptionalChecks) {
        optionalRunning += 1;
      }
    }
  }
  if (requiredPassed < required || optionalRunning > 0) return { kind: 'checks', requiredPassed, required, optionalRunning };
  const notReady = prs.find(({ verdict }) => verdict.status !== 'READY' || (verdict.mergeState !== null && verdict.mergeState !== 'MERGEABLE'));
  if (notReady) return { kind: 'github', number: notReady.number, status: notReady.verdict.status };
  return { kind: 'merge' };
}

/** Whether the stack merge is still under way: not merged, and not stopped. */
export function isUnderWay(merge: StackMerge): boolean {
  return merge.step.kind !== 'merged' && merge.step.kind !== 'stopped';
}

/**
 * Turns "Merge when ready" on for a PR of a GitHub-native stack, merging `stack` (its open PRs from the bottom through
 * this one): GitHub's own stack auto-merge first (`pr.setAutoMerge`). Where GitHub refuses it because the repository does
 * not have it ("Stack auto-merge is not enabled.", whatever the case), CarbonLayer merges the stack when it is ready
 * instead, in the background: a stack merge `whenReady`, which goes by GitHub's own merge rules, so optional checks never
 * hold it up, and which never rebases the stack on its own (a rebase force-pushes every branch) and merges with the commit
 * GitHub proposes then. Any other refusal is GitHub's, for the page to show as it does. Resolves with who will merge it.
 */
export async function mergeStackWhenReady(
  prId: string,
  stack: Pick<StackMergeRequest, 'repo' | 'number' | 'prs' | 'trunk' | 'method' | 'expectedHeadOid'>,
  source: { setAutoMerge(prId: string, enabled: boolean, method: MergeMethod): Promise<void>; startStackMerge(request: StackMergeRequest): Promise<void> },
): Promise<'github' | 'carbonlayer'> {
  try {
    await source.setAutoMerge(prId, true, stack.method);
    return 'github';
  } catch (error) {
    if (!(error instanceof Error && /stack auto-merge is not enabled/i.test(error.message))) throw error;
  }
  await source.startStackMerge({ ...stack, ignoreOptionalChecks: true, rebaseFirst: false, whenReady: true });
  return 'carbonlayer';
}

/** GitHub, asked through a github.com tab's content script: the RPC the app's frame makes (src/lib/rpc.ts). */
export interface GitHubThroughATab {
  /** Rejects with UnansweredRequest when no tab answered, with the content script's failure otherwise. */
  ask<M extends RpcMethod>(method: M, args: RpcMethods[M]['args']): Promise<RpcMethods[M]['result']>;
}

/**
 * A request no github.com tab answered: none could be reached (`reachedTab` false, so GitHub was not asked), or the one
 * asked went away before it answered, so whether GitHub got the request is unknown.
 */
export class UnansweredRequest extends Error {
  constructor(
    message: string,
    readonly reachedTab: boolean,
  ) {
    super(message);
  }
}

/**
 * What GitHub is still to say before the stack can merge: its checks so far, the first PR GitHub has not said can merge,
 * or, merging when ready, a rebase of the stack GitHub says it must have.
 */
const stackWaitSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('checks'), requiredPassed: z.number(), required: z.number(), optionalRunning: z.number() }),
  z.object({ kind: z.literal('github'), number: z.number(), status: z.nullable(z.string()) }),
  z.object({ kind: z.literal('stack-rebase') }),
]);

export type StackWait = z.infer<typeof stackWaitSchema>;

/** What the stack merge dialog (src/pr/MergeStackDialog.tsx) asks for. */
export const stackMergeRequestSchema = z.object({
  repo: repoRefSchema,
  /** The PR the stack merges from, the last of `prs`. */
  number: z.number(),
  /** The open PRs it merges, bottom first, as the dialog listed them. */
  prs: z.array(z.object({ number: z.number(), title: z.string() })),
  trunk: z.string(),
  method: mergeMethodSchema,
  /** The merge commit the viewer wrote; GitHub's proposal without one. */
  commit: z.optional(mergeCommit),
  /**
   * The head of the PR it merges from as the viewer saw it: one pushed since stops the dialog's merge before anything is
   * sent (merging when ready waits through new commits).
   */
  expectedHeadOid: z.string(),
  /** "Ignore optional CI status checks during merge process": unticked, every check must finish successfully too. */
  ignoreOptionalChecks: z.boolean(),
  /** "Always rebase branches before merge": GitHub's Rebase stack first, when its merge box says the stack needs it. */
  rebaseFirst: z.boolean(),
  /**
   * Armed by "Merge when ready" where GitHub has no stack auto-merge for the repository (mergeStackWhenReady), rather than
   * started from the merge dialog: it waits with no time cap through failing checks, missing reviews, new commits and a
   * stack that must be rebased, and stops only on a closed PR, conflicts or a merge GitHub refused.
   */
  whenReady: z.boolean(),
});

export type StackMergeRequest = z.infer<typeof stackMergeRequestSchema>;

/** A stack merge under way, or one that ended: what was asked for, and where it is. */
export const stackMergeSchema = z.extend(stackMergeRequestSchema, {
  id: z.string(),
  /** When it started, in ms since the epoch. */
  startedAt: z.number(),
  /** Each PR's head commit as the merge first saw it (and again after its own rebase), by number; null until then. */
  heads: z.nullable(z.record(z.string(), z.string())),
  step: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('starting') }),
    /** `sent` once GitHub has been asked to rebase (or may have been). */
    z.object({ kind: z.literal('rebasing'), sent: z.boolean() }),
    /**
     * `for` is null until the stack has been looked at. Merging when ready, `lookedAt` is when it last looked and
     * `unchangedSince` since when the stack has waited for the same thing at the same heads, which pace its next look.
     */
    z.object({ kind: z.literal('waiting'), for: z.nullable(stackWaitSchema), lookedAt: z.optional(z.number()), unchangedSince: z.optional(z.number()) }),
    /** `sentAt` once GitHub has been asked to merge (or may have been). */
    z.object({ kind: z.literal('merging'), sentAt: z.nullable(z.number()) }),
    z.object({ kind: z.literal('merged') }),
    z.object({ kind: z.literal('stopped'), reason: z.string() }),
  ]),
  /** Why GitHub could not be asked, or did not answer, the last time; the next step tries again. */
  trouble: z.nullable(z.string()),
});

export type StackMerge = z.infer<typeof stackMergeSchema>;

/** The stack merges in storage.local, under STACK_MERGES. */
export const stackMergesSchema = z.array(stackMergeSchema);

/** What a PR page sends the background: start a stack merge, replacing any of the same PRs, or drop one (cancel, dismiss). */
export const stackMergeMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('carbonlayer-start-stack-merge'), request: stackMergeRequestSchema }),
  z.object({ kind: z.literal('carbonlayer-drop-stack-merge'), id: z.string() }),
]);
