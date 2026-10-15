// The PR page in stages (PrStages in ../model.ts), each loaded on its own so the page renders each part as it arrives.
// The page's cache decides when a stage is asked for again (src/app/query-cache.tsx), so every request here goes to
// GitHub, and stages asked for in the same moment share it while it is on its way: the page's HTML, fetched once, feeds
// the header, the activity, the threads, the merge box and the stack; base_comparison_info feeds the files and the
// threads' positions.

import { z } from 'zod/mini';
import type { ChangedFileDiff, CheckRunSummary, PrStage, PrStages, PrSummary, RepoRef, UserRef } from '../model';
import { getSettings } from '../settings';
import { dynamicWorkflowChecks } from './actions';
import { checksFrom, statusChecksAnswer } from './checks';
import { baseComparisonAnswer, changedFileList, fileDiffs, type BaseComparison } from './files';
import { deferredFields, searchPulls, summarisePull } from './inbox';
import { mergeBoxAnswer, mergeState, type MergeBoxAnswer } from './merge-box';
import { rememberPullRequest } from './mutations';
import { reviewDecisionOf, reviewRequestsAnswer, reviewersOf } from './reviews';
import { SIGNED_OUT, embeddedPayload, getJson, getPage, githubUser } from './session';
import { authorHeaderAnswer, authorIn, graphiteStackComment, nativeStackSchema, resolveStack, stackMergeabilityAnswer } from './stack';
import { conversationsIn, reviewThreads, threadsAnswer } from './threads';
import { descriptionPermalink, reactionsIn, timelineFrom } from './timeline';

/** One stage of a PR's page. */
export function fetchPrStage<S extends PrStage>(stage: S, { repo, number }: { repo: RepoRef; number: number }): Promise<PrStages[S]> {
  const pull = { repo, number, path: `/${repo.owner}/${repo.name}/pull/${number}` };
  return stages[stage](answersFor(pull), pull);
}

/** The diffs of up to 20 of a PR's changed files, by path: the rest of the files stage, a batch at a time. */
export function fetchFileDiffs({ repo, number, paths }: { repo: RepoRef; number: number; paths: string[] }): Promise<Record<string, ChangedFileDiff>> {
  return answersFor({ repo, number, path: `/${repo.owner}/${repo.name}/pull/${number}` }).diffs(paths);
}

/**
 * Stops sharing the requests still on their way, so a stage asked for after a successful write asks GitHub after it,
 * rather than taking an answer GitHub gave before the write.
 */
export function forgetPrAnswers(): void {
  for (const waiting of Object.values(answers)) waiting.clear();
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
      descriptionUrl: descriptionPermalink(page, `https://github.com${pull.path}`),
      headOid: pr.headSha,
      viewerCanUpdate: layout.user?.canEditTitle ?? false,
      viewerDidAuthor: viewerLogin === author.login,
      viewerLogin,
      stackSource: nativeStack ? 'native' : graphiteStackComment(page) ? 'graphite-comment' : 'none',
    };
    rememberPullRequest({
      ...header,
      databaseId: pr.id,
      repositoryDatabaseId: layout.repository?.id ?? undefined,
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
    const { bodyHtml, descriptionReactions, descriptionUrl, headOid, viewerCanUpdate, viewerDidAuthor, viewerLogin, stackSource, ...summary } = header;
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
          mergeability: (number) => answersFor({ repo: pull.repo, number, path: `/${pull.repo.owner}/${pull.repo.name}/pull/${number}` }).stackMergeability(),
          authorsOpenPulls: () => github.authorsOpenPulls(header.author.login),
          conversations: (number) =>
            answersFor({ repo: pull.repo, number, path: `/${pull.repo.owner}/${pull.repo.name}/pull/${number}` })
              .threads()
              .then(conversationsIn, (error: unknown) => {
                console.debug('[gg]', `page_data/threads for ${pull.repo.owner}/${pull.repo.name}#${number} failed; its stack entry shows no conversations:`, error instanceof Error ? error.message : error);
                return null;
              }),
          author: (number) =>
            answersFor({ repo: pull.repo, number, path: `/${pull.repo.owner}/${pull.repo.name}/pull/${number}` })
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

/** What GitHub answers about one PR: a request another stage already has on its way is shared, any other is made. */
function answersFor(pull: Pull) {
  const ask = <T,>(waiting: Map<string, Promise<T>>, variant: string, load: () => Promise<T>): Promise<T> => {
    const key = `${pull.path.toLowerCase()} ${variant}`;
    const asking = waiting.get(key);
    if (asking) return asking;
    const value = load();
    waiting.set(key, value);
    const answered = () => {
      if (waiting.get(key) === value) waiting.delete(key);
    };
    value.then(answered, answered);
    return value;
  };
  const data = `${pull.path}/page_data`;
  // A route behind a side card. GitHub answers 404 for one the repository or viewer lacks, which leaves the card empty;
  // any other failure (no network, a 5xx, rate limiting, an answer of another shape) fails the stage, and the page offers
  // to retry it.
  const sideDetail = <S extends z.ZodMiniType>(route: string, schema: S): Promise<z.infer<S> | null> =>
    getJson(`${data}/${route}`, schema).catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.startsWith('GitHub answered 404')) throw error;
      console.debug('[gg]', `page_data/${route.split('?')[0]} failed; showing the page without it:`, error.message);
      return null;
    });
  const github = {
    page: () => ask(answers.page, '', () => getPage(pull.path)),
    tabCounts: () => ask(answers.tabCounts, '', () => getJson(`${data}/tab_counts`, tabCountsAnswer)),
    diffstat: () => ask(answers.diffstat, '', () => getJson(`${data}/diffstat`, diffstatAnswer)),
    description: () => ask(answers.description, '', () => sideDetail('description', descriptionAnswer)),
    threads: () => ask(answers.threads, '', () => getJson(`${data}/threads`, threadsAnswer)),
    // Who opened the PR, for its entry in another PR's stack.
    author: () => ask(answers.author, '', () => getJson(`${data}/header`, authorHeaderAnswer).then(authorIn)),
    comparison: () => ask(answers.comparison, '', () => getJson(`${data}/base_comparison_info`, baseComparisonAnswer)),
    // The comparison is only asked for should GitHub want a range after all.
    diffs: (paths: string[]) => ask(answers.diffs, paths.join('\n'), () => fileDiffs(pull.path, paths, async () => (await github.comparison()).comparison?.fullDiff?.headOid ?? null)),
    mergeBox: async () => {
      const { mergeMethod } = await getSettings();
      return ask(answers.mergeBox, mergeMethod, () => sideDetail(`merge_box?merge_method=${mergeMethod}&bypass_requirements=false`, mergeBoxAnswer));
    },
    reviewRequests: () => ask(answers.reviewRequests, '', () => sideDetail('review_requests', reviewRequestsAnswer)),
    statusChecks: () => ask(answers.statusChecks, '', () => sideDetail('status_checks', statusChecksAnswer)),
    dynamicChecks: (headRefName: string, headOid: string) => ask(answers.dynamicChecks, headOid, () => dynamicWorkflowChecks(pull.repo, headRefName, headOid)),
    labels: () => ask(answers.labels, '', () => sideDetail('labels', labelsAnswer)),
    assignees: () => ask(answers.assignees, '', () => sideDetail('assignees', assigneesAnswer)),
    stackMergeability: async () => {
      const { mergeMethod } = await getSettings();
      return ask(answers.stackMergeability, mergeMethod, () => sideDetail(`stack_mergeability?merge_method=${mergeMethod}&bypass_requirements=false`, stackMergeabilityAnswer));
    },
    // The entries of Graphite's stack comment, the way the author's open PRs in this repository list them.
    authorsOpenPulls: (author: string) =>
      ask(answers.authorsOpenPulls, author, async () => {
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
  const layout = embeddedPayload(page, 'pullRequestsLayoutRoute', layoutRouteSchema);
  if (!layout) throw new Error(`GitHub's page for ${pull.repo.owner}/${pull.repo.name}#${pull.number} carries no pull request data`);
  return layout;
}

/** page_data/tab_counts (the fields read here). */
const tabCountsAnswer = z.object({ filesChangedCount: z.nullish(z.number()), conversationCount: z.nullish(z.number()), unresolvedConversationCount: z.nullish(z.number()) });

/** page_data/diffstat (the fields read here). */
const diffstatAnswer = z.object({ diffstat: z.nullish(z.object({ linesAdded: z.nullish(z.number()), linesDeleted: z.nullish(z.number()) })) });

/** page_data/description (the fields read here), for a PR whose conversation renders no description. */
const descriptionAnswer = z.object({ bodyHtml: z.nullish(z.string()) });

/** page_data/labels (the fields read here). */
const labelsAnswer = z.object({ labels: z.nullish(z.array(z.object({ name: z.string(), color: z.string() }))) });

/** page_data/assignees (the fields read here). */
const assigneesAnswer = z.object({ assignees: z.nullish(z.array(z.object({ login: z.nullish(z.string()), displayLogin: z.nullish(z.string()), avatarUrl: z.nullish(z.string()) }))) });

/** GitHub's answers while they are on their way, a map for each request, by `<pull path> <variant>`. */
const answers = {
  page: new Map<string, Promise<Document>>(),
  tabCounts: new Map<string, Promise<z.infer<typeof tabCountsAnswer>>>(),
  diffstat: new Map<string, Promise<z.infer<typeof diffstatAnswer>>>(),
  description: new Map<string, Promise<z.infer<typeof descriptionAnswer> | null>>(),
  threads: new Map<string, Promise<z.infer<typeof threadsAnswer>>>(),
  author: new Map<string, Promise<UserRef | null>>(),
  comparison: new Map<string, Promise<BaseComparison>>(),
  diffs: new Map<string, Promise<Record<string, ChangedFileDiff>>>(),
  mergeBox: new Map<string, Promise<MergeBoxAnswer | null>>(),
  reviewRequests: new Map<string, Promise<z.infer<typeof reviewRequestsAnswer> | null>>(),
  statusChecks: new Map<string, Promise<z.infer<typeof statusChecksAnswer> | null>>(),
  dynamicChecks: new Map<string, Promise<CheckRunSummary[]>>(),
  labels: new Map<string, Promise<z.infer<typeof labelsAnswer> | null>>(),
  assignees: new Map<string, Promise<z.infer<typeof assigneesAnswer> | null>>(),
  stackMergeability: new Map<string, Promise<z.infer<typeof stackMergeabilityAnswer> | null>>(),
  authorsOpenPulls: new Map<string, Promise<PrSummary[]>>(),
} satisfies Record<GitHubRequest, Map<string, Promise<unknown>>>;

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
const layoutRouteSchema = z.object({
  pullRequest: z.object({
    /** Database id. */
    id: z.number(),
    relayId: z.string(),
    number: z.number(),
    title: z.string(),
    /** 'OPEN' | 'DRAFT' | 'MERGED' | 'CLOSED' | … */
    state: z.string(),
    author: z.nullish(z.object({ login: z.string(), avatarUrl: z.nullish(z.string()) })),
    baseBranch: z.string(),
    headBranch: z.string(),
    headSha: z.string(),
    createdTime: z.string(),
    closedTime: z.nullish(z.string()),
    mergedTime: z.nullish(z.string()),
  }),
  stack: z.nullish(nativeStackSchema),
  /** The base repository; `id` is its database id. */
  repository: z.nullish(z.object({ id: z.nullish(z.number()) })),
  mergeStatusButtonData: z.nullish(z.object({ defaultMergeMethod: z.nullish(z.enum(['MERGE', 'SQUASH', 'REBASE'])) })),
  user: z.nullish(z.object({ canEditTitle: z.nullish(z.boolean()) })),
});

type LayoutRoute = z.infer<typeof layoutRouteSchema>;
