// What the merge box says: page_data/merge_box is `{ pullRequest: { state, isDraft, isInMergeQueue,
// mergeStateStatus, autoMergeRequest, viewerMergeActions, latestOpinionatedReviews, pendingReviewRequests, … },
// mergeRequirements: { state, conditions, commitMessageHeadline, commitMessageBody, … } }` (its keys verified signed in
// 2026-10-12, docs/research/github-web-mutations.md; not every field in them has been seen, so each is optional).

import { z } from 'zod/mini';
import type { MergeStatus } from '../model';
import type { MergeMethod } from '../rpc';
import { opinionatedReviewSchema, pendingReviewRequestSchema } from './reviews';
import { findInPayload } from './session';

/** Mergeability, the viewer's merge options and auto-merge / merge-queue state. */
export function mergeState(box: MergeBoxAnswer | null, pr: { isDraft: boolean; isOpen: boolean }): MergeState {
  const pullRequest: NonNullable<MergeBoxAnswer['pullRequest']> = box?.pullRequest ?? {};
  const conditions = box?.mergeRequirements?.conditions ?? [];
  const failed = (type: string) => conditions.some((condition) => condition.type === type && condition.result === 'FAILED');

  // A draft's box says DRAFT and fails the PULL_REQUEST_STATE condition; the other conditions still tell whether it
  // conflicts or is blocked, which is what the inbox shows for drafts like for any other PR.
  const reported = pullRequest.mergeStateStatus?.toUpperCase();
  const fromConditions = (): MergeStatus =>
    failed('PULL_REQUEST_MERGE_CONFLICT_STATE')
      ? 'DIRTY'
      : failed('PULL_REQUEST_RULES') || failed('STACK')
        ? 'BLOCKED'
        : box?.mergeRequirements?.state === 'MERGEABLE' || conditions.some((condition) => condition.result === 'PASSED')
          ? 'CLEAN'
          : 'UNKNOWN';
  const reportedStatus = (['CLEAN', 'HAS_HOOKS', 'UNSTABLE', 'BLOCKED', 'BEHIND', 'DIRTY', 'UNKNOWN'] as const).find((status) => status === reported);
  const mergeStatus: MergeStatus = pr.isDraft || pullRequest.isDraft || reported === 'DRAFT' ? fromConditions() : (reportedStatus ?? fromConditions());

  // viewerMergeActions: [{ name: DIRECT_MERGE | AUTO_MERGE | MERGE_QUEUE, mergeMethods: [{ name, allowableStatus, isDefault }] }]
  const actions = pullRequest.viewerMergeActions ?? [];
  const directMerge = actions.find((action) => action.name === 'DIRECT_MERGE');
  const allowed = (directMerge?.mergeMethods ?? [])
    .filter((method) => method.allowableStatus === 'ALLOWED' || method.allowableStatus === 'ALLOWED_WITH_BYPASS')
    .map((method) => method.name)
    .filter((name): name is MergeMethod => name === 'MERGE' || name === 'SQUASH' || name === 'REBASE');
  const userCanMerge = conditions.some((condition) => condition.type === 'PULL_REQUEST_USER_STATE' && condition.result === 'PASSED');
  const autoMergeMethod = pullRequest.autoMergeRequest?.mergeMethod?.toUpperCase();
  const defaultMethod = directMerge?.mergeMethods?.find((method) => method.isDefault)?.name;

  return {
    mergeStatus,
    // Without the actions list, assume every method; the merge box would say otherwise.
    allowedMergeMethods: directMerge ? allowed : ['MERGE', 'SQUASH', 'REBASE'],
    defaultMergeMethod: defaultMethod === 'MERGE' || defaultMethod === 'SQUASH' || defaultMethod === 'REBASE' ? defaultMethod : null,
    viewerCanMerge: pr.isOpen && (directMerge ? directMerge.isAllowable !== false && allowed.length > 0 : userCanMerge),
    // GitHub says so in its own flag (verified 2026-10-13); the merge actions name AUTO_MERGE only in older answers.
    viewerCanEnableAutoMerge:
      pr.isOpen && (pullRequest.viewerCanEnableAutoMerge ?? actions.some((action) => action.name === 'AUTO_MERGE' && action.isAllowable !== false)),
    autoMerge: pullRequest.autoMergeRequest
      ? { method: autoMergeMethod === 'SQUASH' || autoMergeMethod === 'REBASE' ? autoMergeMethod : 'MERGE' }
      : null,
    isInMergeQueue: pullRequest.isInMergeQueue === true,
    latestOpinionatedReviews: pullRequest.latestOpinionatedReviews ?? null,
    numReviewsRequired: box?.numReviewsRequired ?? 0,
  };
}

interface MergeState {
  mergeStatus: MergeStatus;
  allowedMergeMethods: MergeMethod[];
  defaultMergeMethod: MergeMethod | null;
  viewerCanMerge: boolean;
  viewerCanEnableAutoMerge: boolean;
  autoMerge: { method: MergeMethod } | null;
  isInMergeQueue: boolean;
  /** The merge box's `latestOpinionatedReviews`, when it carries them (see reviews.ts). */
  latestOpinionatedReviews: Array<z.infer<typeof opinionatedReviewSchema>> | null;
  numReviewsRequired: number;
}

/**
 * page_data/merge_box: the fields `mergeState` reads, and those the inbox reads besides (why merging is blocked, the
 * pending review requests, the branches and head commit). How many approvals the rules require is not recorded where
 * GitHub puts it; it is looked for by name, wherever nested, and read as `numReviewsRequired`.
 */
export const mergeBoxAnswer = z.pipe(
  z.transform((answer) =>
    typeof answer === 'object' && answer !== null
      ? { ...answer, numReviewsRequired: findInPayload(answer, (key) => key === 'numReviewsRequired' || key === 'requiredApprovingReviewCount') }
      : answer,
  ),
  z.object({
    pullRequest: z.nullish(
      z.object({
        isDraft: z.nullish(z.boolean()),
        isInMergeQueue: z.nullish(z.boolean()),
        isCrossRepo: z.nullish(z.boolean()),
        mergeStateStatus: z.nullish(z.string()),
        autoMergeRequest: z.nullish(z.object({ mergeMethod: z.nullish(z.string()) })),
        viewerCanEnableAutoMerge: z.nullish(z.boolean()),
        viewerMergeActions: z.nullish(
          z.array(
            z.object({
              name: z.string(),
              isAllowable: z.nullish(z.boolean()),
              mergeMethods: z.nullish(z.array(z.object({ name: z.string(), allowableStatus: z.nullish(z.string()), isDefault: z.nullish(z.boolean()) }))),
            }),
          ),
        ),
        latestOpinionatedReviews: z.nullish(z.array(opinionatedReviewSchema)),
        pendingReviewRequests: z.nullish(z.array(pendingReviewRequestSchema)),
        headRefName: z.nullish(z.string()),
        headRefOid: z.nullish(z.string()),
        baseRefName: z.nullish(z.string()),
      }),
    ),
    mergeRequirements: z.nullish(
      z.object({
        state: z.nullish(z.string()),
        conditions: z.nullish(
          z.array(z.object({ type: z.string(), result: z.string(), message: z.nullish(z.string()), description: z.nullish(z.string()), displayName: z.nullish(z.string()) })),
        ),
      }),
    ),
    numReviewsRequired: z.nullish(z.number()),
  }),
);

export type MergeBoxAnswer = z.infer<typeof mergeBoxAnswer>;
