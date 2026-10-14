// Re-running a workflow run's jobs, which GitHub's React PR page cannot do. The Actions run page does it with the classic
// forms of its "Re-run failed jobs" and "Re-run all jobs" dialogs, rendered inline in the page itself (verified signed in
// 2026-10-14, docs/research/github-web-reviewers.md); job_rerun_dialogs_partial holds only the single jobs' dialogs.
// Runs of GitHub's own `dynamic` workflows (Copilot's code review, …) are read from the repository's Actions list too: the
// PR's merge box, its Checks tab and the commit's status rollup leave them out, and Graphite counts them as checks.

import type { CheckRunSummary, CheckState, RepoRef } from '../model';
import { request, submitForm } from './session';

/** Re-runs a run's failed jobs, or all of them, as the run page's dialog would; `offered: false` when GitHub offers no such re-run. */
export async function rerunWorkflowJobs(repoPath: string, runId: string, scope: 'failed' | 'all'): Promise<{ offered: boolean }> {
  const runPage = await request(`${repoPath}/actions/runs/${encodeURIComponent(runId)}`, 'text/html');
  const form = rerunForm(await runPage.text(), scope);
  if (!form) return { offered: false };
  await submitForm(form.action, form.fields);
  return { offered: true };
}

/**
 * The run page's form that re-runs the run's failed jobs, or all of them, with the fields a browser would submit; null when
 * the page offers none (a run with nothing failed, or still running, has no failed-jobs dialog). Verified signed in
 * 2026-10-14: `<dialog id="rerun-dialog-failed">` and `<dialog id="rerun-dialog-all">` hold `<form
 * id="rerun-form-rerun-dialog-failed|all" method="post" action="/{o}/{r}/actions/runs/{id}/rerequest_check_suite">` with a
 * hidden `_method=put`, its own `authenticity_token`, an unticked `enable_debug_logging` box and, for failed jobs only, a
 * hidden `only_failed_check_runs=true`; the nameless submit button sits outside the form (`form="…"`), and the mobile layout
 * repeats both as `rerun-dialog-mobile-…`. A form is recognised by its id first, then by that shape. A single job's form
 * (the same action with a hidden `check_run_id`) never counts.
 */
export function rerunForm(html: string, scope: 'failed' | 'all'): { action: string; fields: Array<[string, string]> } | null {
  const page = new DOMParser().parseFromString(html, 'text/html');
  const runForms = [...page.querySelectorAll('form')].flatMap((form) => {
    const action = form.getAttribute('action');
    return action && form.getAttribute('method')?.toLowerCase() === 'post' && !form.querySelector('input[name="check_run_id"]') ? [{ form, action }] : [];
  });
  const chosen =
    runForms.find(({ form }) => form.id === `rerun-form-rerun-dialog-${scope}`) ??
    runForms.find(
      ({ form, action }) =>
        /\/rerequest_check_suite\/?$/.test(new URL(action, 'https://github.com').pathname) &&
        !!form.querySelector('input[type="hidden"][name="only_failed_check_runs"]') === (scope === 'failed'),
    );
  if (!chosen) return null;

  // What a browser submits: hidden fields (`_method=put` among them, which GitHub reads as the PUT) and ticked boxes as they
  // come, so debug logging stays off. The submit button has no name to add.
  const fields = [...chosen.form.querySelectorAll('input[name]')].flatMap((input): Array<[string, string]> => {
    const { type, name, value, checked } = input as HTMLInputElement;
    return type === 'hidden' || ((type === 'checkbox' || type === 'radio') && checked) ? [[name, value]] : [];
  });
  return { action: chosen.action, fields };
}

/**
 * The checks GitHub's merge box leaves out: the newest run of each of GitHub's own `dynamic` workflows on the branch,
 * when it ran on `headOid`. Only a failed, cancelled or unfinished run is confirmed against its run page and kept; a
 * successful one changes no verdict. Kept 5 minutes a head commit; should GitHub not answer, there are none, so a row or
 * page never breaks over them.
 */
export function dynamicWorkflowChecks(repo: RepoRef, headRefName: string, headOid: string): Promise<CheckRunSummary[]> {
  const key = `${repo.owner}/${repo.name}@${headOid}`;
  const kept = dynamicChecksByHead.get(key);
  if (kept && kept.expiresAt > Date.now()) return kept.checks;
  const repoPath = `/${repo.owner}/${repo.name}`;
  const checks: Promise<CheckRunSummary[]> = (async () => {
    const list = await request(`${repoPath}/actions?${new URLSearchParams({ query: `branch:${headRefName} event:dynamic` })}`, 'text/html');
    const runs = dynamicRunsIn(await list.text()).filter((run) => run.state === 'FAILURE' || run.state === 'CANCELLED' || run.state === 'PENDING');
    // The list does not say which commit a run is for; its page does.
    const onHead = await Promise.all(
      runs.map(async (run) => {
        const sha = runHeadShaIn(await (await request(`${repoPath}/actions/runs/${run.runId}`, 'text/html')).text());
        return sha && headOid.startsWith(sha) ? [run] : [];
      }),
    );
    return onHead.flat().map((run) => ({
      name: `${run.workflow} / ${run.title}`,
      state: run.state,
      url: run.url,
      description: 'GitHub ran this itself (event "dynamic"); it is not a required check',
      group: run.workflow,
      startedAt: run.startedAt,
      completedAt: null,
      runId: run.runId,
    }));
  })().catch((error: unknown) => {
    if (dynamicChecksByHead.get(key)?.checks === checks) dynamicChecksByHead.delete(key);
    console.debug('[gg]', `the Actions list's dynamic runs for ${key} failed; counting none:`, error instanceof Error ? error.message : error);
    return [];
  });
  dynamicChecksByHead.set(key, { expiresAt: Date.now() + 5 * 60_000, checks });
  // A run still going is asked about again soon, so a row does not read "running" for minutes after it finished.
  void checks.then((found) => {
    const kept = dynamicChecksByHead.get(key);
    if (kept?.checks === checks && found.some((check) => check.state === 'PENDING')) kept.expiresAt = Date.now() + 30_000;
  });
  return checks;
}

/**
 * The newest run of each workflow in a repository's Actions list, newest first as the list shows them, from each run's
 * `<li aria-label="<status>: Run <n> of <workflow>. <title>">` with its link and `<relative-time>` (verified 2026-10-12;
 * the class names are hashed). A status other than failed, completed successfully, cancelled or skipped is a run not
 * yet done.
 */
export function dynamicRunsIn(html: string): Array<{ workflow: string; title: string; state: CheckState; url: string; runId: string; startedAt: string | null }> {
  const page = new DOMParser().parseFromString(html, 'text/html');
  const runs = [...page.querySelectorAll('li[aria-label]')].flatMap((item) => {
    const [, status = '', workflow = '', title = ''] = /^(.+?): Run \d+ of (.+?)\. (.*)$/s.exec(item.getAttribute('aria-label') ?? '') ?? [];
    const href = item.querySelector('a[href*="/actions/runs/"]')?.getAttribute('href');
    const runId = /\/actions\/runs\/(\d+)/.exec(href ?? '')?.[1];
    if (!workflow || !href || !runId) return [];
    const state: CheckState =
      status === 'failed' ? 'FAILURE' : status === 'completed successfully' ? 'SUCCESS' : status === 'cancelled' ? 'CANCELLED' : status === 'skipped' ? 'SKIPPED' : 'PENDING';
    return [{ workflow, title, state, url: new URL(href, 'https://github.com').href, runId, startedAt: item.querySelector('relative-time')?.getAttribute('datetime') ?? null }];
  });
  return runs.filter((run, i) => runs.findIndex((other) => other.workflow === run.workflow) === i);
}

/** The commit a workflow run ran on, as its page's title names it ("Running Copilot Code Review · acme/widgets@9824bb7"); null when it names none. */
export function runHeadShaIn(html: string): string | null {
  return /<title>[^<]*@([0-9a-f]{7,40})\s*<\/title>/i.exec(html)?.[1]?.toLowerCase() ?? null;
}

/** What dynamicWorkflowChecks found, by `<owner>/<repo>@<head commit>`, kept 5 minutes; a lookup that failed is not kept. */
const dynamicChecksByHead = new Map<string, { expiresAt: number; checks: Promise<CheckRunSummary[]> }>();
