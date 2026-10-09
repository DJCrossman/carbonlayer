// CI status of a PR's head commit, derived from its check runs and commit statuses.

import type { CheckRunSummary, CheckState, CiSummary } from '../model';
import type { CheckContext } from './queries';

/** One entry per check run / commit status, the counts per bucket, and the overall verdict. */
export function ciSummary(contexts: Array<CheckContext | null>): CiSummary {
  const checks = contexts.flatMap((context): CheckRunSummary[] => {
    if (context?.__typename === 'CheckRun') {
      return [
        {
          name: context.name,
          state: checkRunState(context),
          url: context.detailsUrl,
          description: context.title,
          group: context.checkSuite?.workflowRun?.workflow.name ?? context.checkSuite?.app?.name ?? null,
          startedAt: context.startedAt,
          completedAt: context.completedAt,
        },
      ];
    }
    if (context?.__typename === 'StatusContext') {
      const state: CheckState =
        context.state === 'SUCCESS' ? 'SUCCESS' : context.state === 'PENDING' || context.state === 'EXPECTED' ? 'PENDING' : 'FAILURE';
      return [{ name: context.context, state, url: context.targetUrl, description: context.description, group: null, startedAt: null, completedAt: null }];
    }
    return [];
  });

  const counts = { success: 0, failure: 0, pending: 0, other: 0 };
  for (const check of checks) {
    if (check.state === 'SUCCESS') counts.success++;
    else if (check.state === 'FAILURE') counts.failure++;
    else if (check.state === 'PENDING') counts.pending++;
    else counts.other++;
  }
  const state: CheckState = counts.failure > 0 ? 'FAILURE' : counts.pending > 0 ? 'PENDING' : counts.success > 0 ? 'SUCCESS' : 'NONE';
  return { state, checks, counts };
}

function checkRunState(run: Extract<CheckContext, { __typename: 'CheckRun' }>): CheckState {
  if (run.status !== 'COMPLETED') return 'PENDING';
  switch (run.conclusion) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILURE':
    case 'TIMED_OUT':
    case 'ACTION_REQUIRED':
    case 'STARTUP_FAILURE':
      return 'FAILURE';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'SKIPPED':
      return 'SKIPPED';
    default:
      // NEUTRAL, STALE, or no conclusion reported.
      return 'NEUTRAL';
  }
}
