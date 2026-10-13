// What the merge box says: page_data/merge_box is `{ pullRequest: { state, isDraft, isInMergeQueue,
// mergeStateStatus, autoMergeRequest, viewerMergeActions, latestOpinionatedReviews, pendingReviewRequests, … },
// mergeRequirements: { state, conditions, commitMessageHeadline, commitMessageBody, … } }`, as GitHub's bundle
// reads it (not yet seen in a response, so every field is optional).

import type { MergeStatus } from '../model';
import type { MergeMethod } from '../rpc';
import { findInPayload, noteShape } from './session';

/** Mergeability, the viewer's merge options and auto-merge / merge-queue state. */
export function mergeState(data: unknown, pr: { isDraft: boolean; isOpen: boolean }): MergeState {
  noteShape('page_data/merge_box', data);
  const box = (data ?? {}) as MergeBox;
  const pullRequest = box.pullRequest ?? {};
  noteShape('page_data/merge_box pullRequest', pullRequest);
  const conditions = Array.isArray(box.mergeRequirements?.conditions) ? box.mergeRequirements.conditions : [];
  const failed = (type: string) => conditions.some((condition) => condition.type === type && condition.result === 'FAILED');

  // A draft's box says DRAFT and fails the PULL_REQUEST_STATE condition; the other conditions still tell whether it
  // conflicts or is blocked, which is what the inbox shows for drafts like for any other PR.
  const reported = pullRequest.mergeStateStatus?.toUpperCase();
  const fromConditions = (): MergeStatus =>
    failed('PULL_REQUEST_MERGE_CONFLICT_STATE')
      ? 'DIRTY'
      : failed('PULL_REQUEST_RULES') || failed('STACK')
        ? 'BLOCKED'
        : box.mergeRequirements?.state === 'MERGEABLE' || conditions.some((condition) => condition.result === 'PASSED')
          ? 'CLEAN'
          : 'UNKNOWN';
  const mergeStatus: MergeStatus =
    pr.isDraft || pullRequest.isDraft || reported === 'DRAFT'
      ? fromConditions()
      : reported && ['CLEAN', 'HAS_HOOKS', 'UNSTABLE', 'BLOCKED', 'BEHIND', 'DIRTY', 'UNKNOWN'].includes(reported)
        ? (reported as MergeStatus)
        : fromConditions();

  // viewerMergeActions: [{ name: DIRECT_MERGE | AUTO_MERGE | MERGE_QUEUE, mergeMethods: [{ name, allowableStatus, isDefault }] }]
  const actions = Array.isArray(pullRequest.viewerMergeActions) ? pullRequest.viewerMergeActions : [];
  const directMerge = actions.find((action) => action.name === 'DIRECT_MERGE');
  const allowed = (directMerge?.mergeMethods ?? [])
    .filter((method) => method.allowableStatus === 'ALLOWED' || method.allowableStatus === 'ALLOWED_WITH_BYPASS')
    .map((method) => method.name)
    .filter((name): name is MergeMethod => name === 'MERGE' || name === 'SQUASH' || name === 'REBASE');
  const userCanMerge = conditions.some((condition) => condition.type === 'PULL_REQUEST_USER_STATE' && condition.result === 'PASSED');
  const autoMergeMethod = pullRequest.autoMergeRequest?.mergeMethod?.toUpperCase();

  return {
    mergeStatus,
    // Without the actions list, assume every method; the merge box would say otherwise.
    allowedMergeMethods: directMerge ? allowed : ['MERGE', 'SQUASH', 'REBASE'],
    defaultMergeMethod: (directMerge?.mergeMethods?.find((method) => method.isDefault)?.name as MergeMethod | undefined) ?? null,
    viewerCanMerge: pr.isOpen && (directMerge ? directMerge.isAllowable !== false && allowed.length > 0 : userCanMerge),
    // GitHub says so in its own flag (verified 2026-10-13); the merge actions name AUTO_MERGE only in older answers.
    viewerCanEnableAutoMerge:
      pr.isOpen && (pullRequest.viewerCanEnableAutoMerge ?? actions.some((action) => action.name === 'AUTO_MERGE' && action.isAllowable !== false)),
    autoMerge: pullRequest.autoMergeRequest
      ? { method: autoMergeMethod === 'SQUASH' || autoMergeMethod === 'REBASE' ? autoMergeMethod : 'MERGE' }
      : null,
    isInMergeQueue: pullRequest.isInMergeQueue === true,
    latestOpinionatedReviews: pullRequest.latestOpinionatedReviews ?? findInPayload(data, (key) => key === 'latestOpinionatedReviews') ?? null,
    numReviewsRequired: Number(findInPayload(data, (key) => key === 'numReviewsRequired' || key === 'requiredApprovingReviewCount') ?? 0) || 0,
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
  /** Raw `latestOpinionatedReviews` when the merge box carries them (see reviews.ts). */
  latestOpinionatedReviews: unknown;
  numReviewsRequired: number;
}

/** page_data/merge_box (the fields read here). */
export interface MergeBox {
  pullRequest?: {
    state?: string;
    isDraft?: boolean;
    isInMergeQueue?: boolean;
    mergeStateStatus?: string;
    autoMergeRequest?: { mergeMethod?: string } | null;
    viewerCanEnableAutoMerge?: boolean;
    viewerMergeActions?: Array<{
      name: string;
      isAllowable?: boolean;
      mergeMethods?: Array<{ name: string; allowableStatus?: string; isDefault?: boolean }>;
    }>;
    latestOpinionatedReviews?: unknown;
  };
  mergeRequirements?: {
    state?: string;
    conditions?: Array<{ type: string; result: string }>;
    commitMessageHeadline?: string;
    commitMessageBody?: string;
  };
}
