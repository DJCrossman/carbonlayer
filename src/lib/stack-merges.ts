// Merging a GitHub-native stack the way Graphite's dialog does, with its "Always rebase branches before merge" and "Ignore
// optional CI status checks during merge process", in the background service worker (entrypoints/background.ts), so it
// carries on when the PR's tab closes. GitHub rebases a stack in one request (`pr.rebaseStack`) and merges it in another
// (`pr.merge`, enqueue_stack DIRECT_MERGE from the PR at its top), but waits for nothing short of auto-merge: here,
// CarbonLayer waits. A stack merge lives in storage.local (STACK_MERGES), so a restarted worker or browser carries on with
// it, and moves a step at a time (advanceStackMerge), asking GitHub through a github.com tab's content script.

import { z } from 'zod/mini';
import { mergeMethodSchema, repoRefSchema, type StackReadiness } from './model';
import { mergeCommit, type RpcMethod, type RpcMethods } from './rpc';

/** Where the stack merges are kept in storage.local: those under way, and those that stopped until they are dismissed. */
export const STACK_MERGES = 'stackMerges';

/**
 * The stack merge one step on, from what GitHub says now: started, it looks at the stack and rebases it first when asked
 * to and GitHub says it needs it; then it waits until nothing stands in the way (whatTheStackWaitsFor), merges, and
 * follows the merge until GitHub says it is done. GitHub's refusal of a rebase or a merge stops it, in GitHub's words; a
 * request that could not reach GitHub, or a read that failed, leaves it where it was, saying why (`trouble`), for the
 * next step to try again. Six hours after it started, a merge still waiting stops.
 */
export async function advanceStackMerge(merge: StackMerge, github: GitHubThroughATab, now: number): Promise<StackMerge> {
  const { step } = merge;
  const pull = { repo: merge.repo, number: merge.number };
  const stop = (reason: string): StackMerge => ({ ...merge, trouble: null, step: { kind: 'stopped', reason } });
  if ((step.kind === 'starting' || step.kind === 'rebasing' || step.kind === 'waiting') && now - merge.startedAt > 6 * 60 * 60_000) {
    return stop('CarbonLayer stopped waiting after 6 hours: the stack still could not merge.');
  }
  // What GitHub says of the stack now decides: merge, rebase, wait or stop. The heads the merge merges are those it saw
  // first (and again after its own rebase); any other means someone pushed.
  const decide = (readiness: StackReadiness, rebase: boolean): StackMerge => {
    const heads = merge.heads ?? Object.fromEntries(readiness.prs.map((pr) => [String(pr.number), pr.headOid]));
    const waitsFor = whatTheStackWaitsFor(readiness, { heads, ignoreOptionalChecks: merge.ignoreOptionalChecks, rebase });
    switch (waitsFor.kind) {
      case 'stop':
        return stop(waitsFor.reason);
      case 'rebase':
        return { ...merge, trouble: null, step: { kind: 'rebasing', sent: false } };
      case 'merge':
        return { ...merge, heads, trouble: null, step: { kind: 'merging', sentAt: null } };
      default:
        return { ...merge, heads, trouble: null, step: { kind: 'waiting', for: waitsFor } };
    }
  };
  // A rebase or a merge GitHub refused stops the merge, in its words. One that never reached a tab is sent again next
  // time; one whose tab went away before it answered may have reached GitHub, so from then on GitHub's state says.
  try {
    switch (step.kind) {
      case 'starting': {
        const readiness = await github.ask('pr.fetchStackReadiness', { ...pull, prs: merge.prs.map((pr) => pr.number) });
        // As `pr.merge` does: nothing newer than what the viewer saw is rebased or merged.
        if (readiness.prs.find((pr) => pr.number === merge.number)?.headOid !== merge.expectedHeadOid) {
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
      case 'waiting':
        return decide(await github.ask('pr.fetchStackReadiness', { ...pull, prs: merge.prs.map((pr) => pr.number) }), false);
      case 'merging': {
        const header = await github.ask('pr.fetchHeader', pull);
        if (header.state === 'MERGED') return { ...merge, trouble: null, step: { kind: 'merged' } };
        if (step.sentAt === null) {
          try {
            await github.ask('pr.merge', {
              prId: header.id,
              method: merge.method,
              // GitHub's merge has no head guard; `pr.merge` checks the head is still the one waited for.
              expectedHeadOid: merge.heads?.[String(merge.number)] ?? merge.expectedHeadOid,
              ...(merge.commit && { commit: merge.commit }),
            });
          } catch (error) {
            if (!(error instanceof UnansweredRequest)) return stop(error instanceof Error ? error.message : String(error));
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
 */
export function whatTheStackWaitsFor(
  readiness: StackReadiness,
  { heads, ignoreOptionalChecks, rebase }: { heads: Record<string, string>; ignoreOptionalChecks: boolean; rebase: boolean },
): StackWait | { kind: 'merge' } | { kind: 'rebase' } | { kind: 'stop'; reason: string } {
  const gone = readiness.prs.find((pr) => pr.state !== 'OPEN');
  if (gone) return { kind: 'stop', reason: `#${gone.number} was ${gone.state === 'MERGED' ? 'merged' : 'closed'} meanwhile.` };
  const pushedTo = readiness.prs.find((pr) => (heads[String(pr.number)] ?? pr.headOid) !== pr.headOid);
  if (pushedTo) return { kind: 'stop', reason: `New commits were pushed to #${pushedTo.number} since the merge started. Review them, then merge again.` };
  // GitHub's merge box sections about the stack's branches, in its words.
  const section = readiness.stackSection?.kind;
  if (section === 'current-conflicts' || readiness.mergeStatus === 'DIRTY') return { kind: 'stop', reason: 'This branch has conflicts that must be resolved' };
  if (section === 'conflicts') return { kind: 'stop', reason: 'This stack has conflicts that must be resolved' };
  if (rebase && (section === 'rebase-required' || section === 'rebase-optional')) return { kind: 'rebase' };
  if (section === 'rebase-required') return { kind: 'stop', reason: 'Some branches in this stack have diverged and must be rebased' };

  let requiredPassed = 0;
  let required = 0;
  let optionalRunning = 0;
  for (const pr of readiness.prs) {
    for (const check of pr.ci.checks) {
      const isRequired = pr.requiredCheckNames.includes(check.name);
      const succeeded = check.state === 'SUCCESS' || check.state === 'NEUTRAL' || check.state === 'SKIPPED';
      const failed = check.state === 'FAILURE' || check.state === 'CANCELLED';
      if (failed && (isRequired || !ignoreOptionalChecks)) {
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
  const notReady = readiness.prs.find(({ verdict }) => verdict.status !== 'READY' || (verdict.mergeState !== null && verdict.mergeState !== 'MERGEABLE'));
  if (notReady) return { kind: 'github', number: notReady.number, status: notReady.verdict.status };
  return { kind: 'merge' };
}

/** Whether the stack merge is still under way: not merged, and not stopped. */
export function isUnderWay(merge: StackMerge): boolean {
  return merge.step.kind !== 'merged' && merge.step.kind !== 'stopped';
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

/** What GitHub is still to say before the stack can merge: its checks so far, or the first PR GitHub has not said can merge. */
const stackWaitSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('checks'), requiredPassed: z.number(), required: z.number(), optionalRunning: z.number() }),
  z.object({ kind: z.literal('github'), number: z.number(), status: z.nullable(z.string()) }),
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
  /** The head of the PR it merges from as the viewer saw it: one pushed since stops the merge before anything is sent. */
  expectedHeadOid: z.string(),
  /** "Ignore optional CI status checks during merge process": unticked, every check must finish successfully too. */
  ignoreOptionalChecks: z.boolean(),
  /** "Always rebase branches before merge": GitHub's Rebase stack first, when its merge box says the stack needs it. */
  rebaseFirst: z.boolean(),
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
    /** `for` is null until the stack has been looked at. */
    z.object({ kind: z.literal('waiting'), for: z.nullable(stackWaitSchema) }),
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
