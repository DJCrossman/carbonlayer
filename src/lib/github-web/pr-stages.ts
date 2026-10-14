// The PR page in stages (PrStages in ../model.ts), each loaded on its own so the page renders each part as it arrives.
// What GitHub answers is kept per PR for 30 s and shared by every stage that reads it: the page's HTML, fetched once,
// feeds the header, the activity, the threads, the merge box and the stack; base_comparison_info feeds the files and
// the threads' positions. `force` repeats the requests a stage makes for itself and reuses the rest; a successful write
// forgets what the stages it changes asked (STAGES_A_WRITE_CHANGES in ../rpc.ts).

import type { ChangedFileDiff, PrStage, PrStages, PrSummary, RepoRef, UserRef } from '../model';
import type { MergeMethod } from '../rpc';
import { getSettings } from '../settings';
import { dynamicWorkflowChecks } from './actions';
import { checksFrom } from './checks';
import { changedFileList, fileDiffs, type BaseComparison } from './files';
import { deferredFields, searchPulls, summarisePull } from './inbox';
import { mergeState } from './merge-box';
import { rememberPullRequest } from './mutations';
import { reviewDecisionOf, reviewersOf } from './reviews';
import { SIGNED_OUT, embeddedPayload, getJson, getPage, githubUser } from './session';
import { authorIn, graphiteStackComment, resolveStack, type NativeStack } from './stack';
import { conversationsIn, reviewThreads } from './threads';
import { reactionsIn, timelineFrom } from './timeline';

/** One stage of a PR's page. */
export function fetchPrStage<S extends PrStage>(stage: S, { repo, number, force = false }: { repo: RepoRef; number: number; force?: boolean }): Promise<PrStages[S]> {
  const pull = { repo, number, path: `/${repo.owner}/${repo.name}/pull/${number}` };
  return stages[stage](answersFor(pull, force ? OWN_REQUESTS[stage] : []), pull);
}

/** The diffs of up to 20 of a PR's changed files, by path: the rest of the files stage, a batch at a time. */
export function fetchFileDiffs({ repo, number, paths, force = false }: { repo: RepoRef; number: number; paths: string[]; force?: boolean }): Promise<Record<string, ChangedFileDiff>> {
  return answersFor({ repo, number, path: `/${repo.owner}/${repo.name}/pull/${number}` }, force ? ['diffs'] : []).diffs(paths);
}

/** Forgets, for every PR, what these stages asked GitHub, so they load afresh: what a successful write does. */
export function forgetPrStages(changed: readonly PrStage[]): void {
  const forgotten = new Set(changed.flatMap((stage) => OWN_REQUESTS[stage]));
  for (const key of answers.keys()) {
    if (forgotten.has(key.split(' ')[1] as GitHubRequest)) answers.delete(key);
  }
}

const stages: { [S in PrStage]: (github: GitHubAnswers, pull: Pull) => Promise<PrStages[S]> } = {
  header: async (github, pull) => {
    const [page, tabCounts, diffstat] = await Promise.all([github.page(), github.tabCounts(), github.diffstat()]);
    // Signed out, GitHub still serves a public PR's page (and the routes that work signed out) with an empty `user-login`.
    const viewerLogin = page.querySelector('meta[name="user-login"]')?.getAttribute('content');
    if (!viewerLogin) throw new Error(SIGNED_OUT);
    const layout = layoutOf(page, pull);
    const pr = layout.pullRequest;
    const author = githubUser(pr.author?.login ?? 'ghost', pr.author?.avatarUrl);
    const nativeStack = layout.stack?.pulls?.length ? layout.stack : null;
    // The page has no "updated" time; the latest thing that happened in the conversation is the closest equivalent.
    const times = [pr.createdTime, pr.closedTime, pr.mergedTime, ...[...page.querySelectorAll('.TimelineItem relative-time')].map((time) => time.getAttribute('datetime'))];
    const updatedAt = times.filter((time): time is string => !!time && !Number.isNaN(Date.parse(time))).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? pr.createdTime;
    // The description as the conversation renders it, so it comes with the page; page_data/description when it does not.
    const description = page.querySelector('[id^="pullrequest-"] .comment-body');
    const header: PrStages['header'] = {
      id: pr.relayId,
      repo: pull.repo,
      number: pull.number,
      title: pr.title,
      url: `https://github.com${pull.path}`,
      author,
      state: pr.state === 'MERGED' || pr.state === 'CLOSED' ? pr.state : 'OPEN',
      isDraft: pr.state === 'DRAFT',
      createdAt: pr.createdTime,
      updatedAt,
      mergedAt: pr.mergedTime ?? null,
      headRefName: pr.headBranch,
      baseRefName: pr.baseBranch,
      additions: diffstat.diffstat?.linesAdded ?? 0,
      deletions: diffstat.diffstat?.linesDeleted ?? 0,
      changedFiles: tabCounts.filesChangedCount ?? 0,
      commentCount: tabCounts.conversationCount ?? 0,
      nativeStack: nativeStack && { position: nativeStack.position, size: nativeStack.size },
      bodyHtml: description ? description.innerHTML.trim() : ((await github.description())?.bodyHtml ?? ''),
      // The conversation's reaction form that names the PR itself is the description's.
      descriptionReactions: [...page.querySelectorAll('form.js-pick-reaction')].map((form) => reactionsIn(form)).find(({ subjectId }) => subjectId === pr.relayId)?.reactions ?? [],
      headOid: pr.headSha,
      viewerCanUpdate: layout.user?.canEditTitle ?? false,
      viewerDidAuthor: viewerLogin === author.login,
      viewerLogin,
      stackSource: nativeStack ? 'native' : graphiteStackComment(page) ? 'graphite-comment' : 'none',
    };
    rememberPullRequest({
      ...header,
      databaseId: pr.id,
      repositoryDatabaseId: layout.repository?.id,
      // Any of the conversation's reaction forms will do: their token serves every reaction in the repository.
      reactionToken: page.querySelector('form.js-pick-reaction input[name="authenticity_token"]')?.getAttribute('value') ?? undefined,
    });
    return header;
  },

  activity: async (github, pull) => {
    const [page, threads] = await Promise.all([github.page(), github.threads()]);
    // Only which review opened which threads matters here; where the threads sit comes with the threads stage.
    const { threadIdsByReview } = reviewThreads(threads, { diffSummaries: [] }, page);
    // base_comparison_info carries no commits (its keys are confirmed), so commit rows keep the conversation's times and avatars.
    return { timeline: timelineFrom(page, { pageUrl: `https://github.com${pull.path}`, threadIdsByReview, commits: new Map() }) };
  },

  files: async (github, pull) => {
    const comparison = await github.comparison();
    const baseOid = comparison.comparison?.fullDiff?.baseOid ?? '';
    rememberPullRequest({ repo: pull.repo, number: pull.number, baseOid });
    return { baseOid, ...changedFileList(pull.repo, comparison) };
  },

  threads: async (github, pull) => {
    const [data, comparison, page, tabCounts] = await Promise.all([github.threads(), github.comparison(), github.page(), github.tabCounts()]);
    const { threads } = reviewThreads(data, comparison, page);
    rememberPullRequest({ repo: pull.repo, number: pull.number, baseOid: comparison.comparison?.fullDiff?.baseOid ?? '', threads });
    return { threads, unresolvedThreadCount: tabCounts.unresolvedConversationCount ?? threads.filter((thread) => !thread.isResolved).length };
  },

  mergeBox: async (github, pull) => {
    const [page, box, requests] = await Promise.all([github.page(), github.mergeBox(), github.reviewRequests()]);
    const layout = layoutOf(page, pull);
    const { state, author } = layout.pullRequest;
    const merge = mergeState(box, { isDraft: state === 'DRAFT', isOpen: state !== 'MERGED' && state !== 'CLOSED' });
    // Without review_requests' completed reviews, the verdicts come from the reviews in the conversation.
    const timeline = timelineFrom(page, { pageUrl: `https://github.com${pull.path}`, threadIdsByReview: new Map(), commits: new Map() });
    const reviewers = reviewersOf({ requests, latestOpinionatedReviews: merge.latestOpinionatedReviews, timeline, author: author?.login ?? 'ghost' });
    return {
      mergeStatus: merge.mergeStatus,
      reviewers,
      reviewDecision: reviewDecisionOf(reviewers, merge.numReviewsRequired),
      viewerCanMerge: merge.viewerCanMerge,
      viewerCanEnableAutoMerge: merge.viewerCanEnableAutoMerge,
      allowedMergeMethods: merge.allowedMergeMethods,
      defaultMergeMethod: merge.defaultMergeMethod ?? layout.mergeStatusButtonData?.defaultMergeMethod ?? 'MERGE',
      autoMerge: merge.autoMerge,
      isInMergeQueue: merge.isInMergeQueue,
    };
  },

  checks: async (github, pull) => {
    // GitHub's own dynamic workflow runs (Copilot's review, …) are not in status_checks; the branch's Actions list names
    // them, so the checks wait for the header's branch and head commit too.
    const [answer, { headRefName, headOid }] = await Promise.all([github.statusChecks(), stages.header(github, pull)]);
    const checks = checksFrom(answer, await github.dynamicChecks(headRefName, headOid));
    // What the card says when it has no checks to show; an answer without rows is named by its keys.
    const emptyReason =
      answer === null
        ? 'GitHub answered 404 for page_data/status_checks'
        : checks.ci.checks.length === 0
          ? `GitHub sent no checks (keys: ${Object.keys(answer ?? {}).join(', ') || 'none'})`
          : null;
    return { ...checks, emptyReason };
  },

  stack: async (github, pull) => {
    const [header, page] = await Promise.all([stages.header(github, pull), github.page()]);
    const { stack } = layoutOf(page, pull);
    // The page puts everything it knows about this PR in its own entry; the header is what the stack itself needs.
    const { bodyHtml, descriptionReactions, headOid, viewerCanUpdate, viewerDidAuthor, viewerLogin, stackSource, ...summary } = header;
    const current: PrSummary = {
      ...summary,
      reviewDecision: 'NONE',
      reviewers: [],
      ci: { state: 'NONE', checks: [], counts: { success: 0, failure: 0, pending: 0, other: 0 } },
      mergeStatus: header.isDraft ? 'DRAFT' : 'UNKNOWN',
      labels: [],
      unread: null,
      isInMergeQueue: false,
      autoMerge: null,
      // The page counts them from the threads it shows.
      conversations: null,
    };
    return {
      stack: await resolveStack(
        { current, nativeStack: stack?.pulls?.length ? stack : null, page },
        {
          mergeability: () => github.stackMergeability(),
          authorsOpenPulls: () => github.authorsOpenPulls(header.author.login),
          // Kept with that PR's own answers, so its page reads them from memory should the viewer open it next.
          conversations: (number) =>
            answersFor({ repo: pull.repo, number, path: `/${pull.repo.owner}/${pull.repo.name}/pull/${number}` }, [])
              .threads()
              .then(conversationsIn, (error: unknown) => {
                console.debug('[gg]', `page_data/threads for ${pull.repo.owner}/${pull.repo.name}#${number} failed; its stack entry shows no conversations:`, error instanceof Error ? error.message : error);
                return null;
              }),
          author: (number) =>
            answersFor({ repo: pull.repo, number, path: `/${pull.repo.owner}/${pull.repo.name}/pull/${number}` }, [])
              .author()
              .catch((error: unknown) => {
                console.debug('[gg]', `page_data/header for ${pull.repo.owner}/${pull.repo.name}#${number} failed; its stack entry shows no author:`, error instanceof Error ? error.message : error);
                return null;
              }),
        },
      ),
    };
  },

  meta: async (github) => {
    const [labels, assignees] = await Promise.all([github.labels(), github.assignees()]);
    return {
      labels: (labels?.labels ?? []).map((label) => ({ name: label.name, color: label.color })),
      assignees: (assignees?.assignees ?? []).flatMap((assignee): UserRef[] => {
        const login = assignee.login ?? assignee.displayLogin;
        return login ? [githubUser(login, assignee.avatarUrl)] : [];
      }),
    };
  },
};

/**
 * What GitHub answers about one PR, each from memory while it is fresh or still in flight, except the requests named in
 * `repeat`, which are made again, once for all the stages forced together. Failures are not kept.
 */
function answersFor(pull: Pull, repeat: readonly GitHubRequest[]) {
  const ask = <T,>(request: GitHubRequest, variant: string, load: () => Promise<T>, keepFor = 30_000): Promise<T> => {
    const key = `${pull.path.toLowerCase()} ${request} ${variant}`;
    const kept = answers.get(key);
    const repeating = repeat.includes(request);
    // Another stage forced alongside this one is already asking GitHub again.
    if (kept && (repeating ? kept.repeating : kept.expiresAt > Date.now())) return kept.value as Promise<T>;
    const entry = { expiresAt: Date.now() + keepFor, value: load(), repeating };
    answers.set(key, entry);
    entry.value.then(
      () => {
        entry.repeating = false;
      },
      () => {
        if (answers.get(key) === entry) answers.delete(key);
      },
    );
    return entry.value;
  };
  const data = `${pull.path}/page_data`;
  // A route behind a side card. GitHub answers 404 for one the repository or viewer lacks, which leaves the card empty;
  // any other failure (no network, a 5xx, rate limiting) fails the stage, and the page offers to retry it.
  const sideDetail = <T,>(route: string): Promise<T | null> =>
    getJson<T>(`${data}/${route}`).catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.startsWith('GitHub answered 404')) throw error;
      console.debug('[gg]', `page_data/${route.split('?')[0]} failed; showing the page without it:`, error.message);
      return null;
    });
  const github = {
    page: () => ask('page', '', () => getPage(pull.path)),
    tabCounts: () => ask('tabCounts', '', () => getJson<{ filesChangedCount?: number; conversationCount?: number; unresolvedConversationCount?: number }>(`${data}/tab_counts`)),
    diffstat: () => ask('diffstat', '', () => getJson<{ diffstat?: { linesAdded?: number; linesDeleted?: number } }>(`${data}/diffstat`)),
    description: () => ask('description', '', () => sideDetail<{ bodyHtml?: string }>('description')),
    threads: () => ask('threads', '', () => getJson<unknown>(`${data}/threads`)),
    // Who opened the PR, for its entry in another PR's stack: that never changes, so it is kept 10 minutes.
    author: () => ask('author', '', () => getJson<unknown>(`${data}/header`).then(authorIn), 600_000),
    comparison: () =>
      ask('comparison', '', () => getJson<BaseComparison>(`${data}/base_comparison_info`).then((info) => ({ ...info, diffSummaries: info.diffSummaries ?? [] }))),
    // The comparison is only asked for should GitHub want a range after all.
    diffs: (paths: string[]) => ask('diffs', paths.join('\n'), () => fileDiffs(pull.path, paths, async () => (await github.comparison()).comparison?.fullDiff?.headOid ?? null)),
    mergeBox: async () => {
      const { mergeMethod } = await getSettings();
      return ask('mergeBox', mergeMethod, () => sideDetail<unknown>(`merge_box?merge_method=${mergeMethod}&bypass_requirements=false`));
    },
    reviewRequests: () => ask('reviewRequests', '', () => sideDetail<unknown>('review_requests')),
    statusChecks: () => ask('statusChecks', '', () => sideDetail<unknown>('status_checks')),
    dynamicChecks: (headRefName: string, headOid: string) => ask('dynamicChecks', headOid, () => dynamicWorkflowChecks(pull.repo, headRefName, headOid)),
    labels: () => ask('labels', '', () => sideDetail<{ labels?: Array<{ name: string; color: string }> }>('labels')),
    assignees: () => ask('assignees', '', () => sideDetail<{ assignees?: Array<{ login?: string; displayLogin?: string; avatarUrl?: string }> }>('assignees')),
    stackMergeability: async () => {
      const { mergeMethod } = await getSettings();
      return ask('stackMergeability', mergeMethod, () => sideDetail<unknown>(`stack_mergeability?merge_method=${mergeMethod}&bypass_requirements=false`));
    },
    // The entries of Graphite's stack comment, as the author's open PRs in this repository list them.
    authorsOpenPulls: (author: string) =>
      ask('authorsOpenPulls', author, async () => {
        const query = `repo:${pull.repo.owner}/${pull.repo.name} is:pr is:open author:${author}`;
        try {
          const { pulls } = await searchPulls(query);
          const deferred = await deferredFields(pulls, { query });
          return pulls.map((found) => summarisePull({ ...found, ...deferred.get(found.id) }, null));
        } catch (error) {
          console.debug('[gg]', "the author's open PRs failed; showing the stack from Graphite's comment alone:", error instanceof Error ? error.message : error);
          return [];
        }
      }),
  } satisfies Record<GitHubRequest, unknown>;
  return github;
}

/** What the PR page's embedded data says about the PR; a page that says nothing about it is an error. */
function layoutOf(page: Document, pull: Pull): LayoutRoute {
  const layout = embeddedPayload(page, 'pullRequestsLayoutRoute')?.payload.pullRequestsLayoutRoute as LayoutRoute | undefined;
  if (!layout?.pullRequest) throw new Error(`GitHub's page for ${pull.repo.owner}/${pull.repo.name}#${pull.number} carries no pull request data`);
  return layout;
}

/**
 * The requests each stage makes for itself: `force` makes them again, and a write that changes the stage forgets them.
 * A stage reads the rest from memory (the activity, threads, merge box, checks and stack all read the header's page).
 */
const OWN_REQUESTS: { [S in PrStage]: readonly GitHubRequest[] } = {
  header: ['page', 'tabCounts', 'diffstat', 'description'],
  activity: ['page'],
  files: ['comparison', 'diffs'],
  threads: ['threads', 'comparison', 'tabCounts'],
  mergeBox: ['mergeBox', 'reviewRequests'],
  checks: ['statusChecks', 'dynamicChecks'],
  stack: ['stackMergeability', 'authorsOpenPulls'],
  meta: ['labels', 'assignees'],
};

/**
 * GitHub's answers by `<pull path> <request> <variant>`, kept 30 s (who opened a PR 10 minutes); `repeating` while a
 * forced stage's is on its way.
 */
const answers = new Map<string, { expiresAt: number; value: Promise<unknown>; repeating: boolean }>();

type GitHubAnswers = ReturnType<typeof answersFor>;

type GitHubRequest =
  | 'page'
  | 'tabCounts'
  | 'diffstat'
  | 'description'
  | 'threads'
  | 'author'
  | 'comparison'
  | 'diffs'
  | 'mergeBox'
  | 'reviewRequests'
  | 'statusChecks'
  | 'dynamicChecks'
  | 'labels'
  | 'assignees'
  | 'stackMergeability'
  | 'authorsOpenPulls';

interface Pull {
  repo: RepoRef;
  number: number;
  /** `/{owner}/{repo}/pull/{n}` */
  path: string;
}

/** `payload.pullRequestsLayoutRoute` of the PR page (observed; the fields read here). */
interface LayoutRoute {
  pullRequest: {
    /** Database id. */
    id: number;
    relayId: string;
    number: number;
    title: string;
    state: 'OPEN' | 'DRAFT' | 'MERGED' | 'CLOSED';
    author: { login: string; avatarUrl?: string } | null;
    baseBranch: string;
    headBranch: string;
    headSha: string;
    createdTime: string;
    closedTime?: string | null;
    mergedTime?: string | null;
  };
  stack?: NativeStack | null;
  /** The base repository; `id` is its database id. */
  repository?: { id?: number } | null;
  mergeStatusButtonData?: { defaultMergeMethod?: MergeMethod } | null;
  user?: { canEditTitle?: boolean } | null;
}
