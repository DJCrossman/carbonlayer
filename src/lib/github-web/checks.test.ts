import { describe, expect, it } from 'vitest';
import { checksFrom } from './checks';

describe('checksFrom', () => {
  it('maps status check rows, counts them, and lets one failure fail the whole', () => {
    const { ci, requiredCheckNames } = checksFrom({
      statusRollup: { combinedState: 'SOME_FAILED', summary: [{ state: 'SUCCESS', count: 1 }] },
      statusChecks: [
        { displayName: 'build', state: 'SUCCESS', targetUrl: 'https://ci/1', description: 'Successful in 2m', avatarDescription: 'GitHub Actions', isRequired: true, stateChangedAt: '2026-10-01T10:00:00Z' },
        { displayName: 'lint', state: 'FAILURE', additionalContext: 'Failing after 1m', isRequired: true },
        { displayName: 'e2e', state: 'IN_PROGRESS', stateChangedAt: '2026-10-01T10:05:00Z' },
        { displayName: 'docs', state: 'SKIPPED' },
      ],
    });
    expect(ci.checks.map((check) => [check.name, check.state])).toEqual([
      ['build', 'SUCCESS'],
      ['lint', 'FAILURE'],
      ['e2e', 'PENDING'],
      ['docs', 'SKIPPED'],
    ]);
    expect(ci.checks[0]).toMatchObject({ url: 'https://ci/1', description: 'Successful in 2m', group: 'GitHub Actions', completedAt: '2026-10-01T10:00:00Z' });
    expect(ci.checks[1]?.description).toBe('Failing after 1m');
    expect(ci.checks[2]?.startedAt).toBe('2026-10-01T10:05:00Z');
    expect(ci.counts).toEqual({ success: 1, failure: 1, pending: 1, other: 1 });
    expect(ci.state).toBe('FAILURE');
    expect(requiredCheckNames).toEqual(['build', 'lint']);
  });

  it("falls back to GitHub's combined verdict when there are no rows, and to NONE without anything", () => {
    expect(checksFrom({ statusRollup: { combinedState: 'PENDING_APPROVAL', summary: [] } }).ci.state).toBe('PENDING');
    expect(checksFrom({ statusRollup: { combinedState: 'PASSED', summary: [] } }).ci.state).toBe('SUCCESS');
    expect(checksFrom({}).ci).toEqual({ state: 'NONE', checks: [], counts: { success: 0, failure: 0, pending: 0, other: 0 } });
  });
});
