import { afterEach, describe, expect, it, vi } from 'vitest';
import { dynamicRunsIn, dynamicWorkflowChecks, rerunForm, runHeadShaIn } from './actions';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('rerunForm', () => {
  it("picks the run page's failed-jobs and all-jobs forms by id, never a single job's or the mobile copy, with what a browser would submit", () => {
    const runPage = `
      <dialog id="rerun-dialog-77"><h1>Re-run single job</h1>
        <form id="rerun-form-rerun-dialog-77" method="post" action="/o/r/actions/runs/42/rerequest_check_suite">
          <input type="hidden" name="_method" value="put"><input type="hidden" name="authenticity_token" value="job-token">
          <input type="hidden" name="check_run_id" value="77">
        </form>
      </dialog>
      <dialog id="rerun-dialog-mobile-failed"><h1>Re-run failed jobs</h1>
        <form id="rerun-form-rerun-dialog-mobile-failed" method="post" action="/o/r/actions/runs/42/rerequest_check_suite">
          <input type="hidden" name="_method" value="put"><input type="hidden" name="authenticity_token" value="mobile-failed-token">
          <input type="hidden" name="only_failed_check_runs" value="true">
        </form>
        <button type="submit" form="rerun-form-rerun-dialog-mobile-failed">Re-run jobs</button>
      </dialog>
      <dialog id="rerun-dialog-mobile-all"><h1>Re-run all jobs</h1>
        <form id="rerun-form-rerun-dialog-mobile-all" method="post" action="/o/r/actions/runs/42/rerequest_check_suite">
          <input type="hidden" name="_method" value="put"><input type="hidden" name="authenticity_token" value="mobile-all-token">
        </form>
        <button type="submit" form="rerun-form-rerun-dialog-mobile-all">Re-run jobs</button>
      </dialog>
      <dialog id="rerun-dialog-failed"><h1>Re-run failed jobs</h1>
        <form id="rerun-form-rerun-dialog-failed" accept-charset="UTF-8" method="post" action="/o/r/actions/runs/42/rerequest_check_suite">
          <input type="hidden" name="_method" value="put" autocomplete="off">
          <input type="hidden" name="authenticity_token" value="failed-token" autocomplete="off">
          <input type="hidden" name="only_failed_check_runs" value="true" autocomplete="off">
          <input type="checkbox" name="enable_debug_logging" id="debug-failed" value="true"><label for="debug-failed">Enable debug logging</label>
        </form>
        <button type="button" data-close-dialog-id="rerun-dialog-failed">Cancel</button>
        <button type="submit" form="rerun-form-rerun-dialog-failed">Re-run jobs</button>
      </dialog>
      <dialog id="rerun-dialog-all"><h1>Re-run all jobs</h1>
        <form id="rerun-form-rerun-dialog-all" accept-charset="UTF-8" method="post" action="/o/r/actions/runs/42/rerequest_check_suite">
          <input type="hidden" name="_method" value="put" autocomplete="off">
          <input type="hidden" name="authenticity_token" value="all-token" autocomplete="off">
          <input type="checkbox" name="enable_debug_logging" id="debug-all" value="true"><label for="debug-all">Enable debug logging</label>
        </form>
        <button type="submit" form="rerun-form-rerun-dialog-all">Re-run jobs</button>
      </dialog>`;
    expect(rerunForm(runPage, 'failed')).toEqual({
      action: '/o/r/actions/runs/42/rerequest_check_suite',
      fields: [
        ['_method', 'put'],
        ['authenticity_token', 'failed-token'],
        ['only_failed_check_runs', 'true'],
      ],
    });
    expect(rerunForm(runPage, 'all')).toEqual({
      action: '/o/r/actions/runs/42/rerequest_check_suite',
      fields: [
        ['_method', 'put'],
        ['authenticity_token', 'all-token'],
      ],
    });
  });

  it("falls back to the forms' shape when their ids are unfamiliar, still never a single job's", () => {
    const runPage = `
      <form method="post" action="/o/r/actions/runs/42/rerequest_check_suite">
        <input type="hidden" name="_method" value="put"><input type="hidden" name="authenticity_token" value="job-token"><input type="hidden" name="check_run_id" value="77">
      </form>
      <form method="post" action="/o/r/actions/runs/42/rerequest_check_suite">
        <input type="hidden" name="_method" value="put"><input type="hidden" name="authenticity_token" value="all-token">
      </form>
      <form method="post" action="/o/r/actions/runs/42/rerequest_check_suite">
        <input type="hidden" name="_method" value="put"><input type="hidden" name="authenticity_token" value="failed-token"><input type="hidden" name="only_failed_check_runs" value="true">
      </form>`;
    expect(rerunForm(runPage, 'failed')?.fields).toContainEqual(['authenticity_token', 'failed-token']);
    expect(rerunForm(runPage, 'all')?.fields).toContainEqual(['authenticity_token', 'all-token']);
  });

  it('offers nothing a run page does not: no failed-jobs dialog, no re-run of failed jobs; only single jobs, no re-run at all', () => {
    const job = `
      <form id="rerun-form-rerun-dialog-77" method="post" action="/o/r/actions/runs/42/rerequest_check_suite">
        <input type="hidden" name="_method" value="put"><input type="hidden" name="authenticity_token" value="job-token"><input type="hidden" name="check_run_id" value="77">
      </form>`;
    const all = `
      <form id="rerun-form-rerun-dialog-all" method="post" action="/o/r/actions/runs/42/rerequest_check_suite">
        <input type="hidden" name="_method" value="put"><input type="hidden" name="authenticity_token" value="all-token">
      </form>`;
    expect(rerunForm(job + all, 'failed')).toBeNull();
    expect(rerunForm(job, 'all')).toBeNull();
  });
});

describe('dynamicRunsIn', () => {
  it("reads each workflow's newest run from the Actions list, its status as a check's state", () => {
    const list = `
      <ul>
        <li aria-label="failed: Run 2557 of Copilot. Running Copilot Code Review"><a href="https://github.com/acme/widgets/actions/runs/31">Running Copilot Code Review</a><relative-time datetime="2026-10-12T19:43:25.000Z"></relative-time></li>
        <li aria-label="in progress: Run 12 of Copilot coding agent. Fixing the widget"><a href="https://github.com/acme/widgets/actions/runs/30">Fixing the widget</a><relative-time datetime="2026-10-12T19:40:00.000Z"></relative-time></li>
        <li aria-label="completed successfully: Run 2556 of Copilot. Running Copilot Code Review"><a href="https://github.com/acme/widgets/actions/runs/29">Running Copilot Code Review</a><relative-time datetime="2026-10-11T08:00:00.000Z"></relative-time></li>
        <li aria-label="cancelled: Run 4 of Dependabot Updates. Bump left-pad"><a href="https://github.com/acme/widgets/actions/runs/28">Bump left-pad</a></li>
        <li aria-label="skipped: Run 3 of Automatic Dependency Submission. Submitting dependencies"><a href="https://github.com/acme/widgets/actions/runs/27">Submitting dependencies</a></li>
        <li aria-label="completed successfully: Run 50500 of build-deploy. feat(OS-8476): ship it"><a href="https://github.com/acme/widgets/actions/runs/26">feat(OS-8476): ship it</a></li>
      </ul>`;
    const runs = dynamicRunsIn(list);
    expect(runs[0]).toEqual({
      workflow: 'Copilot',
      title: 'Running Copilot Code Review',
      state: 'FAILURE',
      url: 'https://github.com/acme/widgets/actions/runs/31',
      runId: '31',
      startedAt: '2026-10-12T19:43:25.000Z',
    });
    expect(runs.map((run) => [run.workflow, run.title, run.state])).toEqual([
      ['Copilot', 'Running Copilot Code Review', 'FAILURE'],
      ['Copilot coding agent', 'Fixing the widget', 'PENDING'],
      ['Dependabot Updates', 'Bump left-pad', 'CANCELLED'],
      ['Automatic Dependency Submission', 'Submitting dependencies', 'SKIPPED'],
      ['build-deploy', 'feat(OS-8476): ship it', 'SUCCESS'],
    ]);
  });
});

describe('runHeadShaIn', () => {
  it("reads the commit a run ran on from its page's title, short or whole", () => {
    expect(runHeadShaIn('<html><head><title>Running Copilot Code Review · acme/widgets@9824bb7</title></head></html>')).toBe('9824bb7');
    expect(runHeadShaIn(`<title>Running Copilot Code Review · acme/widgets@${'ab'.repeat(20)}</title>`)).toBe('ab'.repeat(20));
    expect(runHeadShaIn('<title>Actions · acme/widgets</title>')).toBeNull();
  });
});

describe('dynamicWorkflowChecks', () => {
  it('keeps the failed, cancelled and unfinished runs whose page names the head commit, as checks never required', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        const html = url.startsWith('/acme/widgets/actions?')
          ? `<ul>
              <li aria-label="failed: Run 2557 of Copilot. Running Copilot Code Review"><a href="https://github.com/acme/widgets/actions/runs/31">Running Copilot Code Review</a><relative-time datetime="2026-10-12T19:43:25.000Z"></relative-time></li>
              <li aria-label="in progress: Run 12 of Copilot coding agent. Fixing the widget"><a href="https://github.com/acme/widgets/actions/runs/30">Fixing the widget</a></li>
              <li aria-label="completed successfully: Run 4 of Dependabot Updates. Bump left-pad"><a href="https://github.com/acme/widgets/actions/runs/28">Bump left-pad</a></li>
            </ul>`
          : // The agent's run is on an earlier commit of the branch.
            `<title>Running · acme/widgets@${url.endsWith('/31') ? '9824bb7' : '1111111'}</title>`;
        return new Response(html, { headers: { 'content-type': 'text/html' } });
      }),
    );
    expect(await dynamicWorkflowChecks({ owner: 'acme', name: 'widgets' }, 'feat/review', `9824bb7${'0'.repeat(33)}`)).toEqual([
      {
        name: 'Copilot / Running Copilot Code Review',
        state: 'FAILURE',
        url: 'https://github.com/acme/widgets/actions/runs/31',
        description: 'GitHub ran this itself (event "dynamic"); it is not a required check',
        group: 'Copilot',
        startedAt: '2026-10-12T19:43:25.000Z',
        completedAt: null,
        runId: '31',
      },
    ]);
    // A successful run changes no verdict, so its page is not asked for.
    expect(requested).toEqual(['/acme/widgets/actions?query=branch%3Afeat%2Freview+event%3Adynamic', '/acme/widgets/actions/runs/31', '/acme/widgets/actions/runs/30']);
  });

  it('counts none when GitHub does not answer, and asks again next time', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const notFound = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', notFound);
    expect(await dynamicWorkflowChecks({ owner: 'acme', name: 'gadgets' }, 'fix', '9824bb7')).toEqual([]);
    expect(await dynamicWorkflowChecks({ owner: 'acme', name: 'gadgets' }, 'fix', '9824bb7')).toEqual([]);
    expect(notFound).toHaveBeenCalledTimes(2);
    expect(console.debug).toHaveBeenCalledWith('[gg]', expect.stringContaining('acme/gadgets@9824bb7'), 'GitHub answered 404 for /acme/gadgets/actions');
  });
});
