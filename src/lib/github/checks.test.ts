import { describe, expect, it } from 'vitest';
import { ciSummary } from './checks';
import type { CheckContext } from './queries';

describe('ciSummary', () => {
  it('buckets check runs and statuses and lets one failure fail the whole', () => {
    const ci = ciSummary([
      run('build', 'COMPLETED', 'SUCCESS'),
      run('lint', 'COMPLETED', 'TIMED_OUT'),
      run('e2e', 'IN_PROGRESS', null),
      run('docs', 'COMPLETED', 'SKIPPED'),
      run('flaky', 'COMPLETED', 'CANCELLED'),
      status('deploy/preview', 'EXPECTED'),
      status('coverage', 'ERROR'),
      null,
    ]);
    expect(ci.checks.map((check) => [check.name, check.state])).toEqual([
      ['build', 'SUCCESS'],
      ['lint', 'FAILURE'],
      ['e2e', 'PENDING'],
      ['docs', 'SKIPPED'],
      ['flaky', 'CANCELLED'],
      ['deploy/preview', 'PENDING'],
      ['coverage', 'FAILURE'],
    ]);
    expect(ci.counts).toEqual({ success: 1, failure: 2, pending: 2, other: 2 });
    expect(ci.state).toBe('FAILURE');
  });

  it('is pending while anything runs, successful once all pass, and NONE without checks', () => {
    expect(ciSummary([run('build', 'COMPLETED', 'SUCCESS'), run('e2e', 'QUEUED', null)]).state).toBe('PENDING');
    expect(ciSummary([run('build', 'COMPLETED', 'SUCCESS'), run('docs', 'COMPLETED', 'NEUTRAL')]).state).toBe('SUCCESS');
    expect(ciSummary([run('docs', 'COMPLETED', 'SKIPPED')]).state).toBe('NONE');
    expect(ciSummary([]).state).toBe('NONE');
  });

  it('groups check runs by workflow, falling back to the app', () => {
    const [byWorkflow, byApp] = ciSummary([
      run('build', 'COMPLETED', 'SUCCESS'),
      { ...run('scan', 'COMPLETED', 'SUCCESS'), checkSuite: { app: { name: 'CodeQL' }, workflowRun: null } },
    ]).checks;
    expect(byWorkflow?.group).toBe('CI');
    expect(byApp?.group).toBe('CodeQL');
  });
});

type CheckRun = Extract<CheckContext, { __typename: 'CheckRun' }>;
type StatusContext = Extract<CheckContext, { __typename: 'StatusContext' }>;

function run(name: string, status: CheckRun['status'], conclusion: CheckRun['conclusion']): CheckRun {
  return {
    __typename: 'CheckRun',
    name,
    status,
    conclusion,
    detailsUrl: null,
    title: null,
    startedAt: null,
    completedAt: null,
    checkSuite: { app: { name: 'GitHub Actions' }, workflowRun: { workflow: { name: 'CI' } } },
  };
}

function status(context: string, state: StatusContext['state']): StatusContext {
  return { __typename: 'StatusContext', context, state, targetUrl: null, description: null };
}
