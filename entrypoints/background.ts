// The background service worker. It brokers "Copy my sections from Graphite" (src/inbox/GraphiteImport.tsx): it opens
// Graphite's inbox in a tab beside the one that asked, lets that tab's content script (entrypoints/graphite.content.ts)
// copy the sections, stores them where the import dialog looks (`graphiteImport` in storage.local), then closes the
// Graphite tab and returns to the one that asked. Which tab is copying lives in storage.session: the worker may stop
// while Graphite loads, and a browser restart should forget it.
// It also runs the stack merges the merge dialog starts, and those "Merge when ready" arms where GitHub has no stack
// auto-merge for the repository (src/lib/stack-merges.ts), so they carry on when their PR's tab closes: kept in
// storage.local, moved on every 30 s by an alarm, each step asking GitHub through a github.com tab's content script, in a
// tab of its own (opened in the background, closed once the merge ends, or after each look of a merge waiting to merge
// when ready) when no other is open.
// First: zod's messages (src/lib/zod-messages.ts).
import '../src/lib/zod-messages';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { z } from 'zod/mini';
import { graphiteInboxSnapshot } from '../src/lib/graphite';
import { readRpcAnswer, type RpcMethod, type RpcMethods, type RpcRequest } from '../src/lib/rpc';
import {
  STACK_MERGES,
  UnansweredRequest,
  advanceStackMerge,
  isUnderWay,
  stackMergeMessage,
  stackMergesSchema,
  type GitHubThroughATab,
  type StackMerge,
  type StackMergeRequest,
} from '../src/lib/stack-merges';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    // Every runtime message is the extension's own: the import dialog's and the Graphite tab's, and a PR page's.
    const asked = backgroundMessage.parse(message);
    // The inbox's iframe and the options page are frames of a tab too.
    const tabId = sender.tab?.id;
    switch (asked.kind) {
      case 'carbonlayer-open-graphite-import':
        void browser.tabs
          .create({ url: 'https://app.graphite.com/', openerTabId: tabId, windowId: sender.tab?.windowId })
          .then((tab) => browser.storage.session.set({ graphiteImportTab: { tabId: tab.id, openerTabId: tabId } }));
        return;
      case 'carbonlayer-graphite-import-wanted':
        // Every Graphite page asks as it loads; only the tab opened above copies, and only until it has.
        void copyingTab().then((copying) => sendResponse(tabId !== undefined && copying?.tabId === tabId));
        return true;
      case 'carbonlayer-graphite-sections':
        void copyingTab().then(async (copying) => {
          if (tabId === undefined || copying?.tabId !== tabId) return;
          const { sections, defaultRepos, viewerLogin } = asked;
          await browser.storage.local.set({
            graphiteImport: { at: new Date().toISOString(), sections, defaultRepos, ...(viewerLogin !== undefined && { viewerLogin }) },
          });
          await browser.storage.session.remove('graphiteImportTab');
          // The tab that asked may have been closed meanwhile.
          if (copying.openerTabId !== undefined) await browser.tabs.update(copying.openerTabId, { active: true }).catch(() => {});
          await browser.tabs.remove(tabId);
        });
        return;
      case 'carbonlayer-graphite-sections-error':
        // The tab stays open and stays the one copying: once the user signs in there, Graphite loads again and so does
        // the copy.
        void copyingTab().then(async (copying) => {
          if (tabId === undefined || copying?.tabId !== tabId) return;
          await browser.storage.local.set({ graphiteImport: { at: new Date().toISOString(), error: asked.error } });
        });
        return;
      // A PR page hears how it went from storage.local; the answer only says whether it was saved (null) or why not.
      case 'carbonlayer-start-stack-merge':
        startStackMerge(asked.request).then(
          () => sendResponse(null),
          (error: unknown) => sendResponse(error instanceof Error ? error.message : String(error)),
        );
        return true;
      case 'carbonlayer-drop-stack-merge':
        dropStackMerge(asked.id).then(
          () => sendResponse(null),
          (error: unknown) => sendResponse(error instanceof Error ? error.message : String(error)),
        );
        return true;
    }
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === STACK_MERGE_ALARM) void moveStackMergesOn();
  });
  // An alarm may not outlive a browser restart: the merges still under way set it again.
  browser.runtime.onStartup.addListener(() => void moveStackMergesOn());
});

/** The Graphite tab copying sections for an import, and the tab that asked for them; none when no copy is under way. */
async function copyingTab(): Promise<{ tabId: number; openerTabId?: number } | undefined> {
  const { graphiteImportTab } = await browser.storage.session.get('graphiteImportTab');
  return z.optional(z.object({ tabId: z.number(), openerTabId: z.optional(z.number()) })).parse(graphiteImportTab);
}

/**
 * Starts merging a stack, in place of any merge of the same PRs (the dialog has asked the viewer first when one was still
 * under way), and takes its first step at once: with nothing to wait for, it merges right away.
 */
async function startStackMerge(request: StackMergeRequest): Promise<void> {
  const merge: StackMerge = { ...request, id: crypto.randomUUID(), startedAt: Date.now(), heads: null, step: { kind: 'starting' }, trouble: null };
  const replaced: StackMerge[] = [];
  await changeStackMerges((merges) =>
    merges
      .filter((other) => {
        const same = other.repo.owner === merge.repo.owner && other.repo.name === merge.repo.name && other.prs.some((pr) => merge.prs.some(({ number }) => number === pr.number));
        if (same) replaced.push(other);
        return !same;
      })
      .concat(merge),
  );
  for (const other of replaced) await closeTabOpenedFor(other.id);
  await browser.alarms.create(STACK_MERGE_ALARM, { periodInMinutes: 0.5 });
  void moveOn(merge.id);
}

/** Forgets a stack merge: one under way stops where it is (nothing done on GitHub is undone), one that stopped is dismissed. */
async function dropStackMerge(id: string): Promise<void> {
  const merges = await changeStackMerges((all) => all.filter((merge) => merge.id !== id));
  await closeTabOpenedFor(id);
  if (!merges.some(isUnderWay)) await browser.alarms.clear(STACK_MERGE_ALARM);
}

/** On every alarm: each merge under way a step on, and the alarm kept only while there is one. */
async function moveStackMergesOn(): Promise<void> {
  const underWay = (await readStackMerges()).filter(isUnderWay);
  if (underWay.length === 0) {
    await browser.alarms.clear(STACK_MERGE_ALARM);
    return;
  }
  if (!(await browser.alarms.get(STACK_MERGE_ALARM))) await browser.alarms.create(STACK_MERGE_ALARM, { periodInMinutes: 0.5 });
  await Promise.all(underWay.map((merge) => moveOn(merge.id)));
}

/**
 * Moves a stack merge on (advanceStackMerge) and saves where it got to, unless it was dropped meanwhile or had nothing to
 * do yet; a rebase or merge it has just decided on is sent at once, anything else waits for the next alarm. A merge that
 * merged is saved so for the pages watching, then forgotten. Once it has ended, the tab opened for it closes, as it does
 * while a merge waits to merge when ready, which may wait for days: the next look opens one again. With no merge left
 * under way, the alarm stops.
 */
async function moveOn(id: string): Promise<void> {
  // An alarm while this merge is still at its step leaves it be.
  if (moving.has(id)) return;
  moving.add(id);
  // The worker stops 30 s after its last event, and GitHub may take longer to answer a step: asking Chrome something
  // every 25 s keeps it meanwhile.
  const keepAlive = setInterval(() => void browser.runtime.getPlatformInfo(), 25_000);
  try {
    const github = gitHubThroughATab(id);
    for (;;) {
      const merge = (await readStackMerges()).find((candidate) => candidate.id === id);
      if (!merge || !isUnderWay(merge)) break;
      const next = await advanceStackMerge(merge, github, Date.now());
      if (next === merge) break;
      const saved = await changeStackMerges((merges) => merges.map((candidate) => (candidate.id === id ? next : candidate)));
      if (!saved.some((candidate) => candidate.id === id)) break;
      if (next.step.kind === 'merged') await changeStackMerges((merges) => merges.filter((candidate) => candidate.id !== id));
      const writeDue = (next.step.kind === 'rebasing' && !next.step.sent) || (next.step.kind === 'merging' && next.step.sentAt === null);
      if (!writeDue || next.step.kind === merge.step.kind) break;
    }
  } finally {
    clearInterval(keepAlive);
    moving.delete(id);
  }
  const merges = await readStackMerges();
  const merge = merges.find((candidate) => candidate.id === id);
  if (!merge || !isUnderWay(merge) || (merge.whenReady && merge.step.kind === 'waiting')) await closeTabOpenedFor(id);
  if (!merges.some(isUnderWay)) await browser.alarms.clear(STACK_MERGE_ALARM);
}

/**
 * GitHub for one stack merge, through the content script of a github.com tab (entrypoints/github.content.ts answers the
 * requests the app's frame makes): the tab that answered last, else the one opened for the merge, one showing its PR, or
 * any other. A tab without CarbonLayer's content script (one that loaded before it, or failed to load) is passed over.
 * With none to ask, it opens the PR's page, GitHub's own (`?gh=1`), in a tab in the background, which closes once the
 * merge ends (or, merging when ready, once it has looked).
 */
function gitHubThroughATab(id: string): GitHubThroughATab {
  let answeredBy: number | null = null;
  const askIn = async <M extends RpcMethod>(tabId: number, request: RpcRequest<M>): Promise<{ answer: unknown } | null> => {
    try {
      const answer: unknown = await browser.tabs.sendMessage(tabId, request, { frameId: 0 });
      // No listener of this build's in it: GitHub was not asked.
      return answer === undefined ? null : { answer };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The tab that was answering went away (closed, or moved to another page) with the request.
      if (tabId === answeredBy && /message (port|channel) closed/.test(message)) {
        throw new UnansweredRequest(`The github.com tab went away before GitHub answered ${request.method}`, true);
      }
      return null;
    }
  };
  return {
    async ask(method, args) {
      const request = { kind: 'gg-rpc', id: crypto.randomUUID(), method, args } as const;
      const merge = (await readStackMerges()).find((candidate) => candidate.id === id);
      const opened = await tabOpenedFor(id);
      const open = (await browser.tabs.query({ url: 'https://github.com/*' })).filter((tab) => !tab.discarded);
      const prPath = merge && `/${merge.repo.owner}/${merge.repo.name}/pull/${merge.number}`;
      const candidates = [
        ...(answeredBy === null ? [] : [answeredBy]),
        ...(opened === null ? [] : [opened]),
        ...open.filter((tab) => prPath && tab.url && new URL(tab.url).pathname.startsWith(prPath)).flatMap((tab) => (tab.id === undefined ? [] : [tab.id])),
        ...open.flatMap((tab) => (tab.id === undefined ? [] : [tab.id])),
      ];
      for (const tabId of new Set(candidates)) {
        const asked = await askIn(tabId, request);
        if (!asked) continue;
        answeredBy = tabId;
        return readRpcAnswer(method, asked.answer);
      }
      // None answered. Unless the tab opened for the merge is still on github.com (still loading, say), the PR's page opens
      // in another; one taken elsewhere is the viewer's now.
      if (merge && (opened === null || !open.some((tab) => tab.id === opened))) {
        const tab = await browser.tabs.create({ url: `https://github.com/${merge.repo.owner}/${merge.repo.name}/pull/${merge.number}?gh=1`, active: false });
        if (tab.id !== undefined) {
          await browser.storage.session.set({ [`stackMergeTab:${id}`]: tab.id });
          await loaded(tab.id);
          const asked = await askIn(tab.id, request);
          if (asked) {
            answeredBy = tab.id;
            return readRpcAnswer(method, asked.answer);
          }
        }
      }
      throw new UnansweredRequest('No github.com tab could ask GitHub; CarbonLayer tries again in a moment', false);
    },
  };
}

/** The tab opened for a stack merge, while it is still open; null when none was. */
async function tabOpenedFor(id: string): Promise<number | null> {
  const key = `stackMergeTab:${id}`;
  const tabId = z.optional(z.number()).parse((await browser.storage.session.get(key))[key]);
  if (tabId === undefined) return null;
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (tab) return tabId;
  await browser.storage.session.remove(key);
  return null;
}

/** Closes the tab opened for a stack merge once it has ended, unless the viewer is looking at it. */
async function closeTabOpenedFor(id: string): Promise<void> {
  const tabId = await tabOpenedFor(id);
  await browser.storage.session.remove(`stackMergeTab:${id}`);
  if (tabId === null) return;
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (tab && !tab.active) await browser.tabs.remove(tabId).catch(() => {});
}

/** Resolves once the tab has loaded, or after a minute. */
function loaded(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (updated: number, change: { status?: string }) => {
      if (updated === tabId && change.status === 'complete') done();
    };
    const timer = setTimeout(done, 60_000);
    browser.tabs.onUpdated.addListener(onUpdated);
    void browser.tabs.get(tabId).then((tab) => tab.status === 'complete' && done(), done);
  });
}

/**
 * The stack merges in storage.local. Ones this build cannot read (another build's) are forgotten, saying what differs:
 * it could not carry them on.
 */
async function readStackMerges(): Promise<StackMerge[]> {
  const stored: unknown = (await browser.storage.local.get(STACK_MERGES))[STACK_MERGES];
  const read = stackMergesSchema.safeParse(stored ?? []);
  if (read.success) return read.data;
  console.error('[gg]', `${STACK_MERGES} in storage.local did not match, so it is forgotten:`, z.prettifyError(read.error));
  return [];
}

/** Changes the stack merges in storage.local, one change after another so that none undoes another; resolves with what was saved. */
function changeStackMerges(change: (merges: StackMerge[]) => StackMerge[]): Promise<StackMerge[]> {
  const changed = saving.then(async () => {
    const merges = change(await readStackMerges());
    await browser.storage.local.set({ [STACK_MERGES]: merges });
    return merges;
  });
  saving = changed.catch(() => {});
  return changed;
}

/** The alarm that moves the stack merges on while one is under way: every 30 s, as often as Chrome allows. */
const STACK_MERGE_ALARM = 'carbonlayer-stack-merges';

/** The stack merges this worker is moving on right now, by id. */
const moving = new Set<string>();

/** The last change to the stack merges, which the next one waits for. */
let saving: Promise<unknown> = Promise.resolve();

/** What the import dialog (src/inbox/GraphiteImport.tsx), the Graphite tab (graphite.content.ts) and a PR page send here. */
const backgroundMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('carbonlayer-open-graphite-import') }),
  z.object({ kind: z.literal('carbonlayer-graphite-import-wanted') }),
  z.extend(graphiteInboxSnapshot, { kind: z.literal('carbonlayer-graphite-sections') }),
  z.object({ kind: z.literal('carbonlayer-graphite-sections-error'), error: z.string() }),
  stackMergeMessage,
]);
