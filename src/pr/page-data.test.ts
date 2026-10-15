import { QueryClient } from '@tanstack/react-query';
import { assert, describe, expect, it } from 'vitest';
import { prFixtures } from '../fixtures/pr';
import type { PrEnrichment, PrStages, ViewResult } from '../lib/model';
import { nextActionFor } from './next-action';
import { prDetailFrom, stagesStandingIn, type PrPageData } from './page-data';

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

  it("joins each file's diff to it as the diffs arrive; a file still waiting has no patch", () => {
    const [first, second] = files;
    assert.isDefined(first);
    assert.isDefined(second);
    const pr = prDetailFrom(header, {
      ...nothingYet,
      files: {
        status: 'loading',
        value: { baseOid, files: [first, second].map(({ patch, previousPath, ...summary }) => summary), diffs: { [first.path]: { patch: first.patch, previousPath: null } } },
      },
    });
    expect(pr.files).toEqual([{ ...first, previousPath: null }, { ...second, patch: null, previousPath: null }]);
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
