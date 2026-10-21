import { QueryClient } from '@tanstack/react-query';
import { assert, describe, expect, it, vi } from 'vitest';
import { createFixtureDataSource, type DataSource } from '../app/data-source';
import { fixtures } from '../fixtures';
import { prFixtures } from '../fixtures/pr';
import type { PrEnrichment, PrStages, ViewResult } from '../lib/model';
import type { DiffEntryLine } from '../lib/rpc';
import { nextActionFor } from './next-action';
import { prDetailFrom, prHeldBackDiffQuery, stagesStandingIn, type PrPageData } from './page-data';

const pr42 = prFixtures.find((pr) => pr.number === 42);
assert.isDefined(pr42);
const { timeline, threads, unresolvedThreadCount, files, baseOid, stack, labels, assignees, ci, requiredCheckNames, unread, ...rest } = pr42;
const { mergeStatus, reviewers, reviewDecision, viewerCanMerge, viewerCanEnableAutoMerge, allowedMergeMethods, defaultMergeMethod, autoMerge, isInMergeQueue, stackSection, ...headerFields } = rest;
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
      checks: { status: 'ready', value: { ci, requiredCheckNames, emptyReason: null } },
    });
    expect(pr.stack.entries[pr.stack.currentIndex]).toMatchObject({ number: 42, ci: { state: 'FAILURE' } });
    expect(pr.stack.entries.map((entry) => entry.number)).toEqual([41, 42, 43]);
    expect(nextActionFor(pr, ['mergeBox', 'threads'])).toMatchObject({ kind: 'checking' });
  });

  it('marks each entry of the stack the merge box says auto-merge covers, its own too, once the merge box arrives', () => {
    const stackOnly: PrPageData = { ...nothingYet, stack: { status: 'ready', value: { stack } } };
    expect(prDetailFrom(header, stackOnly).stack.entries.map((entry) => entry.willMergeWhenReady)).toEqual([undefined, undefined, undefined]);
    const mergeBox: PrStages['mergeBox'] = { mergeStatus, reviewers, reviewDecision, viewerCanMerge, viewerCanEnableAutoMerge, allowedMergeMethods, defaultMergeMethod, autoMerge, isInMergeQueue, stackSection, autoMergeRange: [41, 42] };
    const pr = prDetailFrom(header, { ...stackOnly, mergeBox: { status: 'ready', value: mergeBox } });
    expect(pr.stack.entries.map((entry) => [entry.number, entry.willMergeWhenReady])).toEqual([[41, true], [42, true], [43, false]]);
    expect(pr).not.toHaveProperty('autoMergeRange');
  });

  it("joins each file's diff to it as the diffs arrive; a file still waiting has no patch", () => {
    const [first, second] = files;
    assert.isDefined(first);
    assert.isDefined(second);
    const pr = prDetailFrom(header, {
      ...nothingYet,
      files: {
        status: 'loading',
        value: {
          baseOid,
          files: [first, second].map(({ patch, previousPath, withheld, generated, ...summary }) => summary),
          diffs: { [first.path]: { patch: first.patch, previousPath: null, withheld: null, generated: false } },
        },
      },
    });
    expect(pr.files).toEqual([{ ...first, previousPath: null }, { ...second, patch: null, previousPath: null, withheld: null, generated: false }]);
  });
});

describe('stagesStandingIn', () => {
  const widgets = { owner: 'acme', name: 'widgets' };
  // #42's stack as its page showed it: #41 below, #43 above.
  const showedStack = () => {
    const client = new QueryClient();
    client.setQueryData(['pr', 'acme', 'widgets', 42, 'stack'], { stack });
    return client;
  };

  it("stands in for a neighbour opened from a stack card with its entry: the header, and the stack centred on it; with its row details, the reviewers and checks", () => {
    const client = showedStack();
    const fromEntry = stagesStandingIn(client, widgets, 41);
    expect(fromEntry.header).toMatchObject({ number: 41, title: 'Add a typed PARCS client', author: { login: 'mona' }, bodyHtml: '', stackSource: 'graphite-comment' });
    expect(fromEntry.stack?.stack).toMatchObject({ currentIndex: 0, entries: [{ number: 41 }, { number: 42 }, { number: 43 }] });
    expect(fromEntry).not.toHaveProperty('meta');
    expect(fromEntry).not.toHaveProperty('mergeBox');

    const details: PrEnrichment = { mergeStatus: 'CLEAN', reviewers: [{ kind: 'user', user: { login: 'hubot', avatarUrl: '', url: '' }, state: 'APPROVED' }], reviewDecision: 'APPROVED', ci };
    client.setQueryData(['inbox-row', 'PR_fixture41', '2026-10-08T16:20:00Z', 'OPEN', false, 'NONE', 'SQUASH'], details);
    expect(stagesStandingIn(client, widgets, 41)).toMatchObject({ mergeBox: { mergeStatus: 'CLEAN', reviewDecision: 'APPROVED', reviewers: [{ state: 'APPROVED' }] }, checks: { ci: { state: 'FAILURE' } } });
  });

  it("prefers the inbox's row, with its labels, and still centres the stack the page showed on the PR", () => {
    const client = showedStack();
    const [, , entry] = stack.entries;
    assert.isDefined(entry);
    const row = { ...entry, author: { login: 'jlord', avatarUrl: '', url: '' }, title: 'Show the zone switcher (as the inbox listed it)', labels: [{ name: 'ui', color: '000000' }] };
    const section: Pick<ViewResult, 'prs'> = { prs: [row] };
    client.setQueryData(['inbox', 'acme', 'org:acme', 'mine', 'is:pr', 50], section);
    expect(stagesStandingIn(client, widgets, 43)).toMatchObject({
      header: { title: 'Show the zone switcher (as the inbox listed it)', stackSource: 'graphite-comment' },
      meta: { labels: [{ name: 'ui' }], assignees: [] },
      stack: { stack: { currentIndex: 2 } },
    });
  });

  it('stands in with no header for an entry whose author GitHub did not name, and with nothing for a PR neither showed', () => {
    const client = new QueryClient();
    client.setQueryData(['pr', 'acme', 'widgets', 42, 'stack'], { stack: { ...stack, entries: stack.entries.map((entry) => ({ ...entry, author: null })) } });
    expect(Object.keys(stagesStandingIn(client, widgets, 43))).toEqual(['stack']);
    expect(stagesStandingIn(client, widgets, 7)).toEqual({});
  });
});

describe('prHeldBackDiffQuery', () => {
  const answer: DiffEntryLine[] = [
    { type: 'HUNK', left: 0, right: 0, text: '@@ -1,2 +1,2 @@', displayNoNewLineWarning: false },
    { type: 'CONTEXT', left: 1, right: 1, text: " lockfileVersion: '9.0'", displayNoNewLineWarning: false },
    { type: 'DELETION', left: 2, right: 1, text: '-    react: 19.2.4', displayNoNewLineWarning: false },
    { type: 'ADDITION', left: 2, right: 2, text: '+    react: 19.2.5', displayNoNewLineWarning: true },
  ];

  it("asks once for a held-back file's whole diff, without ranges, and makes its patch from GitHub's lines", async () => {
    const fetchPrDiffLines = vi.fn(async (..._args: Parameters<DataSource['fetchPrDiffLines']>) => answer);
    const query = prHeldBackDiffQuery({ ...createFixtureDataSource(fixtures), fetchPrDiffLines }, { owner: 'o', name: 'r' }, 1, { headOid: 'head', baseRefName: 'main' }, 'pnpm-lock.yaml');
    const queryClient = new QueryClient();

    expect(await queryClient.fetchQuery(query)).toBe("@@ -1,2 +1,2 @@\n lockfileVersion: '9.0'\n-    react: 19.2.4\n+    react: 19.2.5\n\\ No newline at end of file");
    await queryClient.fetchQuery(query);
    expect(fetchPrDiffLines.mock.calls).toEqual([[{ owner: 'o', name: 'r' }, 1, 'pnpm-lock.yaml', 'head', []]]);
  });

  it('fails, to be retried, when GitHub sends no lines for it', async () => {
    const source = { ...createFixtureDataSource(fixtures), fetchPrDiffLines: async () => answer.slice(0, 0) };
    const query = prHeldBackDiffQuery(source, { owner: 'o', name: 'r' }, 1, { headOid: 'head', baseRefName: 'main' }, 'pnpm-lock.yaml');
    await expect(new QueryClient().fetchQuery({ ...query, retry: false })).rejects.toThrow('GitHub sent no lines for this file');
  });
});
