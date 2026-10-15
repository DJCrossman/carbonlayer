// CI for the PR page from page_data/status_checks: `{ statusChecks: [row], statusRollup: { combinedState,
// summary: [{ state, count }] }, aliveChannels }` (verified signed in 2026-10-12, docs/research/github-web-endpoints.md),
// rows `{ displayName, state, isRequired, targetUrl, description, additionalContext, stateChangedAt, … }`. The rows'
// other names for those fields (`name`, `conclusion`, `detailsUrl`, …) date from before that and are still read.

import { z } from 'zod';
import type { CheckRunSummary, CheckState, CiSummary } from '../model';

/**
 * The checks with their states, counts and overall verdict, the names of the required ones, whether the rows say which
 * are required at all (when none does, `requiredCheckNames` is empty for want of knowing), and whether GitHub listed
 * the checks (`listed`; without a list the verdict is its rollup's). Graphite's mergeability check is left out: it
 * waits on the downstack PRs, not on CI, and the stack card reports that. `alsoChecks`, checks the list leaves out
 * (GitHub's own dynamic workflow runs), join it and count like it, never as required.
 */
export function checksFrom(
  answer: StatusChecksAnswer | null,
  alsoChecks: CheckRunSummary[] = [],
): { ci: CiSummary; requiredCheckNames: string[]; marksRequired: boolean; listed: boolean } {
  const listed = Array.isArray(answer?.statusChecks);
  const rows = (answer?.statusChecks ?? []).filter((row) => !/mergeability_check/i.test(row.displayName ?? row.name ?? row.context ?? ''));

  const checks = rows.map((row): CheckRunSummary => {
    // Anything not yet finished is PENDING.
    const status = row.status?.toUpperCase();
    const outcome = (row.state ?? row.conclusion ?? row.status ?? '').toUpperCase();
    const state: CheckState =
      status && status !== 'COMPLETED' && !row.conclusion && !row.state
        ? 'PENDING'
        : outcome === 'SUCCESS' || outcome === 'PASSED'
          ? 'SUCCESS'
          : ['FAILURE', 'FAILED', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(outcome)
            ? 'FAILURE'
            : ['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED'].includes(outcome)
              ? 'PENDING'
              : outcome === 'CANCELLED' || outcome === 'SKIPPED'
                ? outcome
                : 'NEUTRAL';
    // GitHub links its own checks by path; the app lives on another origin, so every link is made absolute here.
    const link = row.targetUrl ?? row.detailsUrl ?? row.url ?? null;
    return {
      name: row.displayName ?? row.name ?? row.context ?? '',
      state,
      url: link ? new URL(link, 'https://github.com').href : null,
      description: row.description || row.additionalContext || row.title || null,
      group: row.avatarDescription ?? row.workflowName ?? row.app?.name ?? null,
      startedAt: row.startedAt ?? (state === 'PENDING' ? (row.stateChangedAt ?? null) : null),
      completedAt: row.completedAt ?? (state === 'PENDING' ? null : (row.stateChangedAt ?? null)),
      // An Actions job links to /{owner}/{repo}/actions/runs/{runId}/job/{jobId}.
      runId: /\/actions\/runs\/(\d+)/.exec(row.targetUrl ?? row.detailsUrl ?? row.url ?? '')?.[1] ?? null,
    };
  });
  // After the rows' own checks, so a row's index is still its check's; a name the list already has keeps its row.
  for (const extra of alsoChecks) {
    if (!checks.some((check) => check.name === extra.name)) checks.push(extra);
  }
  const counts = { success: 0, failure: 0, pending: 0, other: 0 };
  for (const check of checks) {
    if (check.state === 'SUCCESS') counts.success++;
    else if (check.state === 'FAILURE') counts.failure++;
    else if (check.state === 'PENDING') counts.pending++;
    else counts.other++;
  }
  // GitHub's own verdict, for when the rows are missing: PASSED, PENDING*, SOME_FAILED, FAILED, PENDING_FAILED.
  const combined = answer?.statusRollup?.combinedState?.toUpperCase() ?? '';
  const combinedState: CheckState = combined === 'PASSED' ? 'SUCCESS' : /FAILED/.test(combined) ? 'FAILURE' : /PENDING/.test(combined) ? 'PENDING' : 'NONE';
  // A required failure is final; otherwise, as in Graphite, the checks are running until the last one is done, and only
  // then do optional failures count (a failing check among running ones may still be re-run or superseded).
  const requiredCheckNames = rows.flatMap((row, i) => {
    const check = checks[i];
    return check && (row.isRequired ?? row.required) ? [check.name] : [];
  });
  const requiredFailed = checks.some((check) => check.state === 'FAILURE' && requiredCheckNames.includes(check.name));
  const state: CheckState = requiredFailed
    ? 'FAILURE'
    : counts.pending > 0
      ? 'PENDING'
      : counts.failure > 0
        ? 'FAILURE'
        : counts.success > 0
          ? 'SUCCESS'
          : listed
            ? 'NONE'
            : combinedState;
  return {
    ci: { state, checks, counts },
    requiredCheckNames,
    marksRequired: rows.some((row) => typeof (row.isRequired ?? row.required) === 'boolean'),
    listed,
  };
}

/**
 * page_data/status_checks (the fields read here). Its other keys are kept, unread: the checks card names them when
 * GitHub sends no rows.
 */
export const statusChecksAnswer = z.looseObject({
  statusRollup: z.object({ combinedState: z.string().nullish() }).nullish(),
  statusChecks: z
    .array(
      z.object({
        displayName: z.string().nullish(),
        name: z.string().nullish(),
        context: z.string().nullish(),
        state: z.string().nullish(),
        conclusion: z.string().nullish(),
        status: z.string().nullish(),
        stateChangedAt: z.string().nullish(),
        targetUrl: z.string().nullish(),
        detailsUrl: z.string().nullish(),
        url: z.string().nullish(),
        description: z.string().nullish(),
        additionalContext: z.string().nullish(),
        title: z.string().nullish(),
        avatarDescription: z.string().nullish(),
        workflowName: z.string().nullish(),
        app: z.object({ name: z.string().nullish() }).nullish(),
        startedAt: z.string().nullish(),
        completedAt: z.string().nullish(),
        isRequired: z.boolean().nullish(),
        required: z.boolean().nullish(),
      }),
    )
    .nullish(),
});

type StatusChecksAnswer = z.infer<typeof statusChecksAnswer>;
