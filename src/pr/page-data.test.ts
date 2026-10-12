import { describe, expect, it } from 'vitest';
import { prFixtures } from '../fixtures/pr';
import type { PrStages } from '../lib/model';
import { nextActionFor } from './next-action';
import { prDetailFrom, type PrPageData } from './page-data';

const pr42 = prFixtures.find((pr) => pr.number === 42)!;
const { timeline, threads, unresolvedThreadCount, files, baseOid, stack, labels, assignees, ci, requiredCheckNames, unread, ...rest } = pr42;
const { mergeStatus, reviewers, reviewDecision, viewerCanMerge, viewerCanEnableAutoMerge, allowedMergeMethods, defaultMergeMethod, autoMerge, isInMergeQueue, ...headerFields } = rest;
const header: PrStages['header'] = { ...headerFields, viewerLogin: 'octocat', stackSource: 'graphite-comment' };
const nothingYet: PrPageData = {
  header: { status: 'ready', value: header },
  activity: { status: 'loading', value: null },
  files: { status: 'loading', value: null },
  threads: { status: 'loading', value: null },
  mergeBox: { status: 'loading', value: null },
  checks: { status: 'loading', value: null },
  stack: { status: 'loading', value: null },
  meta: { status: 'loading', value: null },
};

describe('prDetailFrom', () => {
  it('shows the header alone as a PR with nothing known yet about reviews, checks, files or its stack', () => {
    const pr = prDetailFrom(header, nothingYet);
    expect(pr).toMatchObject({
      title: 'Add zone switching to the PARCS adapter',
      changedFiles: 6,
      ci: { state: 'NONE', checks: [] },
      reviewers: [],
      mergeStatus: 'UNKNOWN',
      viewerCanMerge: false,
      labels: [],
      timeline: [],
      threads: [],
      files: [],
      stack: { source: 'none', currentIndex: 0, entries: [{ number: 42 }] },
    });
    // The sidebar's next step waits for what decides it.
    expect(nextActionFor(pr, ['mergeBox', 'stack', 'threads', 'checks'])).toMatchObject({ kind: 'checking', title: 'Checking mergeability…' });
  });

  it("puts everything that arrived about this PR in its own stack entry, and keeps the stack's other entries", () => {
    const pr = prDetailFrom(header, {
      ...nothingYet,
      stack: { status: 'ready', value: { stack } },
      checks: { status: 'ready', value: { ci, requiredCheckNames } },
    });
    expect(pr.stack.entries[pr.stack.currentIndex]).toMatchObject({ number: 42, ci: { state: 'FAILURE' } });
    expect(pr.stack.entries.map((entry) => entry.number)).toEqual([41, 42, 43]);
    expect(nextActionFor(pr, ['mergeBox', 'threads'])).toMatchObject({ kind: 'checking' });
  });

  it("joins each file's diff to it as the diffs arrive; a file still waiting has no patch", () => {
    const [first, second] = files;
    const pr = prDetailFrom(header, {
      ...nothingYet,
      files: {
        status: 'loading',
        value: { baseOid, files: [first!, second!].map(({ patch, previousPath, ...summary }) => summary), diffs: { [first!.path]: { patch: first!.patch, previousPath: null } } },
      },
    });
    expect(pr.files).toEqual([{ ...first, previousPath: null }, { ...second, patch: null, previousPath: null }]);
  });
});
