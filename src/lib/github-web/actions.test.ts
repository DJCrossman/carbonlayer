import { describe, expect, it } from 'vitest';
import { rerunForm } from './actions';

describe('rerunForm', () => {
  it("picks the run's failed-jobs and all-jobs forms by action, never a single job's, with what a browser would submit", () => {
    const dialogs = `
      <dialog><h1>Re-run single job</h1>
        <form action="/o/r/actions/runs/42/jobs/77/rerun" method="post">
          <input type="hidden" name="authenticity_token" value="job-token"><button type="submit">Re-run job</button>
        </form>
      </dialog>
      <dialog><h1>Re-run all jobs</h1>
        <form action="/o/r/actions/runs/42/rerun" accept-charset="UTF-8" method="post">
          <input type="hidden" name="authenticity_token" value="all-token">
          <input type="checkbox" name="enable_debug_logging" value="1">
          <button type="submit">Re-run jobs</button>
        </form>
      </dialog>
      <dialog><h1>Re-run failed jobs</h1>
        <form action="/o/r/actions/runs/42/rerun_failed_jobs" method="post">
          <input type="hidden" name="authenticity_token" value="failed-token">
          <input type="hidden" name="attempt" value="2">
          <input type="checkbox" name="enable_debug_logging" value="1" checked>
          <button type="submit">Re-run jobs</button>
        </form>
      </dialog>`;
    expect(rerunForm(dialogs, 'failed')).toEqual({
      action: '/o/r/actions/runs/42/rerun_failed_jobs',
      fields: [
        ['authenticity_token', 'failed-token'],
        ['attempt', '2'],
        ['enable_debug_logging', '1'],
      ],
    });
    expect(rerunForm(dialogs, 'all')).toEqual({ action: '/o/r/actions/runs/42/rerun', fields: [['authenticity_token', 'all-token']] });
  });

  it('falls back to what the dialog says when the actions are unfamiliar, also inside templates', () => {
    const dialogs = `
      <template><div role="dialog"><h2>Re-run all jobs</h2>
        <form action="/o/r/actions/runs/42/retry" method="post"><input type="hidden" name="authenticity_token" value="t1"><button>Re-run</button></form>
      </div></template>
      <template><div role="dialog"><h2>Re-run failed jobs</h2>
        <form action="/o/r/actions/runs/42/retry" method="post"><input type="hidden" name="authenticity_token" value="t2"><button name="only_failed" value="true">Re-run</button></form>
      </div></template>`;
    expect(rerunForm(dialogs, 'failed')?.fields).toEqual([
      ['authenticity_token', 't2'],
      ['only_failed', 'true'],
    ]);
    expect(rerunForm(dialogs, 'all')?.fields).toEqual([['authenticity_token', 't1']]);
  });

  it('finds nothing in the shell GitHub serves signed out', () => {
    const shell = `<div class="js-updatable-content js-socket-channel" data-channel="x" data-url="/cli/cli/actions/runs/37957561849/job_rerun_dialogs_partial">\n  </div>\n`;
    expect(rerunForm(shell, 'failed')).toBeNull();
    expect(rerunForm(shell, 'all')).toBeNull();
  });
});
