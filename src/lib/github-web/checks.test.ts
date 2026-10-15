import { describe, expect, it } from 'vitest';
import { checksFrom, statusChecksAnswer } from './checks';

describe('checksFrom', () => {
  it('maps status check rows, counts them, and lets one failure fail the whole', () => {
    const { ci, requiredCheckNames } = checksFrom(statusChecksAnswer.parse({
      statusRollup: { combinedState: 'SOME_FAILED', summary: [{ state: 'SUCCESS', count: 1 }] },
      statusChecks: [
        { displayName: 'build', state: 'SUCCESS', targetUrl: 'https://ci/1', description: 'Successful in 2m', avatarDescription: 'GitHub Actions', isRequired: true, stateChangedAt: '2026-10-01T10:00:00Z' },
        { displayName: 'lint', state: 'FAILURE', additionalContext: 'Failing after 1m', isRequired: true },
        { displayName: 'e2e', state: 'IN_PROGRESS', stateChangedAt: '2026-10-01T10:05:00Z' },
        { displayName: 'docs', state: 'SKIPPED' },
      ],
    }));
    expect(ci.checks.map((check) => [check.name, check.state])).toEqual([
      ['build', 'SUCCESS'],
      ['lint', 'FAILURE'],
      ['e2e', 'PENDING'],
      ['docs', 'SKIPPED'],
    ]);
    expect(ci.checks[0]).toMatchObject({ url: 'https://ci/1', description: 'Successful in 2m', group: 'GitHub Actions', completedAt: '2026-10-01T10:00:00Z' });
    // GitHub links its Actions jobs by path; the link must work from the app's own origin.
    expect(checksFrom(statusChecksAnswer.parse({ statusChecks: [{ displayName: 'build', state: 'SUCCESS', targetUrl: '/acme/widgets/actions/runs/12/job/34' }] })).ci.checks[0]).toMatchObject({
      url: 'https://github.com/acme/widgets/actions/runs/12/job/34',
      runId: '12',
    });
    expect(ci.checks[1]?.description).toBe('Failing after 1m');
    expect(ci.checks[2]?.startedAt).toBe('2026-10-01T10:05:00Z');
    expect(ci.counts).toEqual({ success: 1, failure: 1, pending: 1, other: 1 });
    expect(ci.state).toBe('FAILURE');
    expect(requiredCheckNames).toEqual(['build', 'lint']);
  });

  it('says whether the rows mark which checks are required', () => {
    expect(checksFrom(statusChecksAnswer.parse({ statusChecks: [{ displayName: 'lint', state: 'FAILURE', isRequired: false }] }))).toMatchObject({ requiredCheckNames: [], marksRequired: true });
    expect(checksFrom(statusChecksAnswer.parse({ statusChecks: [{ displayName: 'lint', state: 'FAILURE' }] }))).toMatchObject({ requiredCheckNames: [], marksRequired: false });
  });

  it('names the workflow run of each GitHub Actions job (link shape as on cli/cli#14320), for re-runs', () => {
    const { ci } = checksFrom(statusChecksAnswer.parse({
      statusChecks: [
        { displayName: 'lint', state: 'FAILURE', targetUrl: 'https://github.com/cli/cli/actions/runs/34362049624/job/102501237455?pr=14320' },
        { displayName: 'preview', state: 'SUCCESS', targetUrl: 'https://vercel.com/acme/widgets/123' },
      ],
    }));
    expect(ci.checks.map((check) => check.runId)).toEqual(['34362049624', null]);
  });

  it('is still running while checks run and only optional ones have failed; a required failure is final', () => {
    const running = checksFrom(statusChecksAnswer.parse({
      statusChecks: [
        { displayName: 'build', state: 'SUCCESS', isRequired: true },
        { displayName: 'preview', state: 'FAILURE', isRequired: false },
        { displayName: 'e2e', state: 'IN_PROGRESS', isRequired: true },
      ],
    }));
    expect(running.ci.state).toBe('PENDING');
    expect(running.ci.counts).toEqual({ success: 1, failure: 1, pending: 1, other: 0 });
    const done = checksFrom(statusChecksAnswer.parse({ statusChecks: [{ displayName: 'build', state: 'SUCCESS', isRequired: true }, { displayName: 'preview', state: 'FAILURE', isRequired: false }] }));
    expect(done.ci.state).toBe('FAILURE');
    const required = checksFrom(statusChecksAnswer.parse({ statusChecks: [{ displayName: 'build', state: 'FAILURE', isRequired: true }, { displayName: 'e2e', state: 'IN_PROGRESS', isRequired: true }] }));
    expect(required.ci.state).toBe('FAILURE');
  });

  it("leaves Graphite's mergeability check out: a stacked PR whose other checks passed has passed", () => {
    const { ci, listed } = checksFrom(statusChecksAnswer.parse({
      statusRollup: { combinedState: 'PENDING', summary: [] },
      statusChecks: [
        { displayName: 'build', state: 'SUCCESS', isRequired: true },
        { displayName: 'Graphite / mergeability_check', state: 'PENDING', avatarDescription: 'Graphite', description: 'This check will pass when downstack PRs merge' },
      ],
    }));
    expect(ci.checks.map((check) => check.name)).toEqual(['build']);
    expect(ci.state).toBe('SUCCESS');
    expect(listed).toBe(true);
    // With nothing but that check, there are no checks, whatever the rollup says.
    const alone = checksFrom(statusChecksAnswer.parse({ statusRollup: { combinedState: 'PENDING', summary: [] }, statusChecks: [{ displayName: 'Graphite / mergeability_check', state: 'PENDING' }] }));
    expect(alone.ci).toEqual({ state: 'NONE', checks: [], counts: { success: 0, failure: 0, pending: 0, other: 0 } });
    expect(alone.listed).toBe(true);
  });

  it("counts checks the list leaves out, GitHub's own dynamic workflow runs, never as required and a listed name once", () => {
    const copilot = {
      name: 'Copilot / Running Copilot Code Review',
      state: 'FAILURE',
      url: 'https://github.com/acme/widgets/actions/runs/31',
      description: 'GitHub ran this itself (event "dynamic"); it is not a required check',
      group: 'Copilot',
      startedAt: '2026-10-12T19:43:25.000Z',
      completedAt: null,
      runId: '31',
    } as const;
    const { ci, requiredCheckNames } = checksFrom(statusChecksAnswer.parse({ statusRollup: { combinedState: 'PASSED', summary: [] }, statusChecks: [{ displayName: 'build', state: 'SUCCESS', isRequired: true }] }), [copilot]);
    expect(ci.state).toBe('FAILURE');
    expect(ci.checks.map((check) => check.name)).toEqual(['build', 'Copilot / Running Copilot Code Review']);
    expect(ci.checks[1]).toEqual(copilot);
    expect(ci.counts).toEqual({ success: 1, failure: 1, pending: 0, other: 0 });
    expect(requiredCheckNames).toEqual(['build']);
    const listed = checksFrom(statusChecksAnswer.parse({ statusChecks: [{ displayName: 'Copilot / Running Copilot Code Review', state: 'SUCCESS' }] }), [copilot]);
    expect(listed.ci.checks.map((check) => [check.name, check.state])).toEqual([['Copilot / Running Copilot Code Review', 'SUCCESS']]);
  });

  it("falls back to GitHub's combined verdict when there are no rows, and to NONE without anything", () => {
    expect(checksFrom(statusChecksAnswer.parse({ statusRollup: { combinedState: 'PENDING_APPROVAL', summary: [] } })).ci.state).toBe('PENDING');
    expect(checksFrom(statusChecksAnswer.parse({ statusRollup: { combinedState: 'PASSED', summary: [] } })).ci.state).toBe('SUCCESS');
    expect(checksFrom(statusChecksAnswer.parse({})).ci).toEqual({ state: 'NONE', checks: [], counts: { success: 0, failure: 0, pending: 0, other: 0 } });
    expect(checksFrom(statusChecksAnswer.parse({})).listed).toBe(false);
  });
});
