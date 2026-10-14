// Re-running failed GitHub Actions checks from the PR page (c r, or the Checks card). GitHub re-runs a workflow run, not a
// check, so the failing checks are grouped by run and the runs re-run one after another from here; nothing opens on GitHub.
// A run GitHub offers no such re-run for is left alone, and the toast says so. The checks are refetched a few seconds
// later, once GitHub has queued the jobs again.
import { useMemo, useState } from 'react';
import type { DataSource } from '../app/data-source';
import type { PrDetail } from '../lib/model';
import { showToast } from '../ui/Toast';

export function useCheckReruns(pr: PrDetail, source: DataSource, refetch: () => Promise<void>): CheckReruns {
  const [running, setRunning] = useState(false);
  const failedRunIds = useMemo(() => [...new Set(pr.ci.checks.flatMap((check) => (check.state === 'FAILURE' && check.runId ? [check.runId] : [])))], [pr.ci.checks]);

  async function rerun(scope: 'failed' | 'all') {
    if (running) return;
    if (failedRunIds.length === 0) {
      showToast('No failed GitHub Actions checks to re-run');
      return;
    }
    setRunning(true);
    const started: string[] = [];
    const declined: string[] = [];
    let failure: string | null = null;
    for (const runId of failedRunIds) {
      try {
        const { offered } = await (scope === 'failed' ? source.rerunFailedJobs(pr.id, runId) : source.rerunAllJobs(pr.id, runId));
        (offered ? started : declined).push(runId);
      } catch (reason) {
        failure = reason instanceof Error ? reason.message : String(reason);
        break;
      }
    }
    const jobs = scope === 'failed' ? 'failed jobs' : 'all jobs';
    if (failure) showToast(`Could not re-run the checks: ${failure}`, 'danger');
    else if (declined.length > 0 && started.length === 0) showToast(`GitHub offers no re-run of ${jobs} for ${declined.length === 1 ? 'that run' : 'those runs'} right now`);
    else if (declined.length > 0) showToast(`Re-running ${jobs} in ${started.length} of ${started.length + declined.length} workflow runs; GitHub offers none for the rest right now`);
    else showToast(started.length === 1 ? `Re-running ${jobs}` : `Re-running ${jobs} in ${started.length} workflow runs`);
    if (started.length === 0) {
      setRunning(false);
      return;
    }
    setTimeout(() => {
      refetch()
        .catch((reason: unknown) => showToast(`Re-run started, but reloading the PR failed: ${reason instanceof Error ? reason.message : String(reason)}`, 'danger'))
        .finally(() => setRunning(false));
    }, 3000);
  }

  return { failedRunIds, running, rerun };
}

export interface CheckReruns {
  /** The workflow runs with a failed check, each once. */
  failedRunIds: string[];
  running: boolean;
  rerun: (scope: 'failed' | 'all') => Promise<void>;
}
