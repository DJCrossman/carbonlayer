// Re-running a workflow run's jobs, which GitHub's React PR page cannot do. The Actions run page does it with classic
// forms that it loads into its "Re-run jobs" dialogs from job_rerun_dialogs_partial (docs/research/github-web-reviewers.md).
// Signed out that partial is an empty shell (observed); signed in, the forms' actions and fields are read, not assumed.

import { request, submitForm } from './session';

/** Re-runs a run's failed jobs, or all of them, as the run page's dialog would; `offered: false` when GitHub offers no such re-run. */
export async function rerunWorkflowJobs(repoPath: string, runId: string, scope: 'failed' | 'all'): Promise<{ offered: boolean }> {
  const dialogs = await request(`${repoPath}/actions/runs/${encodeURIComponent(runId)}/job_rerun_dialogs_partial`, 'text/html', { xhr: true });
  const form = rerunForm(await dialogs.text(), scope);
  if (!form) return { offered: false };
  await submitForm(form.action, form.fields);
  return { offered: true };
}

/**
 * The form in GitHub's re-run dialogs that re-runs the run's failed jobs, or all of them, with the fields a browser would
 * submit; null when there is none. A form is recognised by its action first (`…/rerun_failed_jobs` or `…/rerun-failed-jobs`;
 * the run's own `…/rerun`), then by what its dialog says ("failed", "all jobs"). A single job's form never counts.
 */
export function rerunForm(html: string, scope: 'failed' | 'all'): { action: string; fields: Array<[string, string]> } | null {
  const page = new DOMParser().parseFromString(html, 'text/html');
  // A dialog's content may wait in a <template> until it opens.
  const forms = [page, ...[...page.querySelectorAll('template')].map((template) => template.content)].flatMap((root) => [...root.querySelectorAll('form')]);
  const runForms = forms.flatMap((form) => {
    const action = form.getAttribute('action');
    if (!action || form.getAttribute('method')?.toLowerCase() !== 'post') return [];
    const url = new URL(action, 'https://github.com');
    if (/\/jobs?\/\d+/.test(url.pathname)) return [];
    const wording = (form.closest('dialog, modal-dialog, details-dialog, [role="dialog"]') ?? form).textContent ?? '';
    return [{ form, action, path: url.pathname, wording, mentionsFailed: /failed/i.test(`${url.search} ${wording}`) }];
  });
  const chosen =
    scope === 'failed'
      ? (runForms.find(({ path }) => /rerun[-_]failed/i.test(path)) ?? runForms.find(({ mentionsFailed }) => mentionsFailed))
      : (runForms.find(({ path, mentionsFailed }) => /\/runs\/\d+\/rerun\/?$/.test(path) && !mentionsFailed) ??
        runForms.find(({ wording, mentionsFailed }) => /all jobs/i.test(wording) && !mentionsFailed));
  if (!chosen) return null;

  // What a browser submits: hidden fields, ticked boxes as they come, and the submit button's own name if it has one.
  const fields = [...chosen.form.querySelectorAll('input[name]')].flatMap((input): Array<[string, string]> => {
    const { type, name, value, checked } = input as HTMLInputElement;
    return type === 'hidden' || ((type === 'checkbox' || type === 'radio') && checked) ? [[name, value]] : [];
  });
  const submitter = chosen.form.querySelector<HTMLButtonElement | HTMLInputElement>('button[name]:not([type="button"]):not([type="reset"]), input[type="submit"][name]');
  if (submitter) fields.push([submitter.name, submitter.value]);
  return { action: chosen.action, fields };
}
