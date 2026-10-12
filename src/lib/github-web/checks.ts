// CI for the PR page from page_data/status_checks: `{ statusChecks: [row], statusRollup: { combinedState,
// summary: [{ state, count }] } }`. That shape and the row fields (`displayName`, `state`, `stateChangedAt`,
// `targetUrl`, `description`, `additionalContext`, `avatarDescription`, `isRequired`) come from GitHub's bundle,
// not from a response, so the list is also found by what its rows look like and fields have fallbacks.

import type { CheckRunSummary, CheckState, CiSummary } from '../model';
import { findInPayload, noteShape } from './session';

/**
 * The checks with their states, counts and overall verdict, the names of the required ones, whether the rows say which
 * are required at all (when none does, `requiredCheckNames` is empty for want of knowing), and whether GitHub listed
 * the checks (`listed`; without a list the verdict is its rollup's). Graphite's mergeability check is left out: it
 * waits on the downstack PRs, not on CI, and the stack card reports that.
 */
export function checksFrom(data: unknown): { ci: CiSummary; requiredCheckNames: string[]; marksRequired: boolean; listed: boolean } {
  noteShape('page_data/status_checks', data);
  const response = (data ?? {}) as { statusChecks?: unknown; statusRollup?: { combinedState?: string } };
  const looksLikeChecks = (value: unknown) =>
    Array.isArray(value) &&
    value.some((item) => {
      const row = item as Record<string, unknown> | null;
      return !!row && ('displayName' in row || 'name' in row || 'context' in row) && ('state' in row || 'conclusion' in row || 'status' in row);
    });
  const found = Array.isArray(response.statusChecks) ? response.statusChecks : findInPayload(data, (_, value) => looksLikeChecks(value));
  const listed = Array.isArray(found);
  const rows = (listed ? found : []).filter((row: CheckRow) => !/mergeability_check/i.test(row.displayName ?? row.name ?? row.context ?? ''));
  noteShape('page_data/status_checks row', rows);

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
  const counts = { success: 0, failure: 0, pending: 0, other: 0 };
  for (const check of checks) {
    if (check.state === 'SUCCESS') counts.success++;
    else if (check.state === 'FAILURE') counts.failure++;
    else if (check.state === 'PENDING') counts.pending++;
    else counts.other++;
  }
  // GitHub's own verdict, for when the rows are missing: PASSED, PENDING*, SOME_FAILED, FAILED, PENDING_FAILED.
  const combined = response.statusRollup?.combinedState?.toUpperCase() ?? '';
  const combinedState: CheckState = combined === 'PASSED' ? 'SUCCESS' : /FAILED/.test(combined) ? 'FAILURE' : /PENDING/.test(combined) ? 'PENDING' : 'NONE';
  const state: CheckState =
    counts.failure > 0 ? 'FAILURE' : counts.pending > 0 ? 'PENDING' : counts.success > 0 ? 'SUCCESS' : listed ? 'NONE' : combinedState;
  return {
    ci: { state, checks, counts },
    requiredCheckNames: rows.flatMap((row, i) => ((row.isRequired ?? row.required) ? [checks[i]!.name] : [])),
    marksRequired: rows.some((row) => typeof (row.isRequired ?? row.required) === 'boolean'),
    listed,
  };
}


interface CheckRow {
  displayName?: string;
  name?: string;
  context?: string;
  state?: string;
  conclusion?: string | null;
  status?: string;
  stateChangedAt?: string | null;
  targetUrl?: string | null;
  detailsUrl?: string | null;
  url?: string | null;
  description?: string | null;
  additionalContext?: string | null;
  title?: string | null;
  avatarDescription?: string | null;
  workflowName?: string | null;
  app?: { name?: string } | null;
  startedAt?: string | null;
  completedAt?: string | null;
  isRequired?: boolean;
  required?: boolean;
}
