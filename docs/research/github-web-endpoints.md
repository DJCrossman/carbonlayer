# github.com session endpoints (observed 2026-10-09 in a signed-in Chrome)

These are the same-origin JSON endpoints GitHub's own React UI calls. They are cookie-authenticated:
a content script on github.com can call them with `fetch(path, { headers: { Accept: 'application/json',
'X-Requested-With': 'XMLHttpRequest' } })` (same-origin, cookies attached). Signed-out they return 404
`{"error":"Not Found"}` for the gated ones. Shapes below were read from GitHub's React component props
and embedded page data; `s:` = string sample, `n:` = number, `b:` = boolean, `[N, …]` = array of N.

## Pull request dashboard (`/pulls`, redirects to `/pulls/inbox`)

Page HTML carries `<script type="application/json" data-target="react-app.embeddedData">` with
`payload.pullsDashboardSurfaceLayoutRoute` = `{ compactMode, savedViews[], sidebarLinks[{id, name, path,
query, icon, source, search_type, color}], sso, filters, selectedRepos[], defaultViewId, collapsedSections[],
sectionOrder[], hiddenSections[], sidebarExpanded }` and `appPayload.{current_user, inboxSectionQueries,
sso_organizations}`. Built-in sidebar links: inbox (""), authored (`is:pr author:@me state:open archived:false
sort:updated-desc`), assigned, involved.

### Built-in inbox sections
`GET /pulls/inbox/queries?filter=<id>&max_pr_age=1m` for each of `review-requested`, `team-review-requested`,
`your-drafts`, `waiting-for-review`, `needs-action`, `ready-to-merge`, `merge-queue` → **shape to confirm at
runtime; expected `{ results: Pull[], totalCount }`** (the embedded first section is
`sectionReviewRequestedBlocking: { results: [], totalCount: 0 }`). Section component props:
`config: { id, name, maxItems, href, emptyDescription, description, queries: [{ query }] }`.
Then `GET /pulls/inbox/deferred?page=1&ids[]=<id>&ids[]=…` fills the deferred fields.

### Any search query (custom views)
`GET /pulls/search?q=<query>` returns HTML whose embedded `payload.pullsDashboardSurfaceContentRoute` is
`{ results: Pull[], pageInfo: { currentPage, totalPages, totalCount, openCount, closedCount }, error }`
(`page=N` for more). Then `GET /pulls/deferred?q=<query>&page=1&ids[]=…` (same relay ids) returns the deferred
fields as `{ meta: { title }, payload: { pullsDashboardSurfaceContentDeferredData: { results: { "0": row, "1": row, … } } } }`
— `results` is an object keyed by index, not an array (VERIFIED signed in 2026-10-12 from GitHub's React Query cache;
GitHub's own search sends `q` with ` sort:updated-desc` appended). Each row is `{ id, reviewDecisionState,
statusCheckRollup, approvedReviewsCount, changesRequestedReviewsCount }`; the inbox sections' `/pulls/inbox/deferred`
rows have the same fields (GitHub caches them per id). Try `Accept: application/json` first; fall back to parsing the HTML.

### Pull (search result / inbox row)
```
itemType: 'pull_request'          assignees: [{login, avatarUrl}?]   author: { displayLogin }
authoredByAgent: bool             category: 'YOUR_DRAFTS' | null     commentCount: n
commitHeadShaChannel: s           agentAttributedUser: null          closedAt/createdAt/mergedAt/updatedAt: ISO
displayState: 'OPEN'|'DRAFT'|'MERGED'|'CLOSED'   headSha: s         labels: [{name, color}?]
id: 'PR_kwDO…' (relay id)         aliveChannel                        isDraft: bool
isReadByCurrentUser: bool         mergeQueueUrl: s|null               number: n
permalink: s (absolute URL)       repoNameWithOwner: 'owner/repo'     stackPosition: n|null  stackSize: n|null
state: 'OPEN'|…                   taskListItemCount / completeTaskListItemCount: n
title: s   titleHtml: s
-- deferred (present after /deferred, `deferredDataStatus` says whether loaded):
reviewDecisionState: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | … (uppercase)
statusCheckRollup: { state: 'PENDING'|'SUCCESS'|'FAILURE'|…, totalCount: n, successCount: n }
approvedReviewsCount: n           changesRequestedReviewsCount: n
```
Row UI shows aria-labels like "Draft pull request", "34/34 checks passing".

## Pull request page (`/{owner}/{repo}/pull/{n}`) — React app `repo`

HTML embedded data `payload.pullRequestsLayoutRoute`:
```
pullRequest: { id: n (database id), relayId: 'PR_kwDO…', number, title, titleHtml, state: 'OPEN'|…,
  author: { login, displayName, avatarUrl, isAgent, slug }, baseBranch, headBranch, headRepositoryName,
  headRepositoryOwnerLogin, headSha, commitsCount, createdTime, closedTime, mergedTime, mergedBy,
  mergeCommitSha, viewerAllowedNonCommentReviewTypes: [] }
stack: null | { id, number, position, size, baseBranch, createdAt, repositoryOwnerLogin, repositoryName,
  allPullsLocked, pulls: [{ number, title, state, url: '/o/r/pull/N', headBranch, headOid,
  isInAutoMergeRange, isUnstackable }] }          -- GitHub-native stacks only; position 1 = bottom
repository: { id, name, ownerLogin, defaultBranch, codespacesEnabled, … }
user: { canComment, canEditTitle, canChangeBase, canFixWithCopilot, notices }
mergeStatusButtonData: { defaultMergeMethod: 'MERGE'|'SQUASH'|'REBASE', headSha, viewerLogin, channels, helpUrl }
viewerPendingReview: { id: null|…, comments: [] }
urls: { conversation, files, changes, commits, checks, findings, overview, walkthrough }
featureStates, viewSettings, pageTitle
```
`payload.pullRequestsConversationsRoute`: `{ id, locked, defaultMergeMethod, mergeboxChannels, … }`.

The **conversation timeline is server-rendered classic HTML** inside the React app: `.TimelineItem`
elements. A comment: `.timeline-comment` (`#issuecomment-N`, the PR body is `#pullrequest-<id>`) with
`a.author`, `relative-time[datetime]`, `.comment-body` (rendered Markdown HTML). A review:
`#pullrequestreview-N` with an `h3` like "babakks left a comment" / "approved these changes". Events are
`.TimelineItem` with a `.TimelineItem-badge svg.octicon-<name>` (seen: repo-push, git-commit, eye =
review requested, stack = added to stack, cross-reference). Graphite's stack comment is one of the comments.

Data endpoints (all `page_data/*` need a session; `tab_counts` and `diffstat` also work signed out):
- `GET …/page_data/tab_counts` → `{ annotationsCount, checksCount, conversationCount, filesChangedCount,
  filesChangedCountLimitExceeded, unresolvedConversationCount, findingsCount }`
- `GET …/page_data/diffstat` → `{ diffstat: { linesAdded, linesDeleted, linesChanged } }`
- `GET …/page_data/merge_box?merge_method=MERGE&bypass_requirements=false` → feeds `MergeBox` props:
  `mergeRequirements: { state: 'MERGEABLE'|'UNMERGEABLE'|…, conditions: [{ type, displayName, description,
  message, result: 'PASSED'|'FAILED'|… }], commitMessageHeadline, commitMessageBody, defaultCommitAuthorEmail,
  possibleCommitAuthorEmails }` with condition types PULL_REQUEST_STATE, PULL_REQUEST_REPO_STATE,
  PULL_REQUEST_USER_STATE, PULL_REQUEST_RULES, PULL_REQUEST_MERGE_CONFLICT_STATE, PULL_REQUEST_MERGE_METHOD,
  STACK; `pullRequest: { autoMergeRequest, baseRefName, headRefName, … }`; `ReviewerSection` props
  `latestOpinionatedReviews: [{ id, author: { login, avatarUrl, name, url }, state: 'APPROVED'|…,
  authorCanPushToRepository, onBehalfOf }], pendingRequestedReviews: [{ reviewer, isCodeOwner }],
  reviewsState, numReviewsRequired, viewerCanReRequestReviews`. Exact top-level JSON keys: confirm at runtime.
  The inbox asks this route, and `diffstat`, for each row on screen to fill the merge status, reviewers and line
  counts the dashboard rows lack (`enrichPull` in `src/lib/github-web/inbox.ts`). Whether the merge box names reviewers
  (`latestOpinionatedReviews`, `pendingReviewRequests` / `pendingRequestedReviews`) has not been seen signed in; without
  them the row shows no reviewer avatars.
- `GET …/page_data/status_checks` → the checks list: `{ statusChecks: [{ displayName, state, isRequired, targetUrl,
  description, additionalContext, stateChangedAt, durationInSeconds, avatarUrl, … }], statusRollup: { combinedState,
  summary, pendingWorkflowApprovalRollup }, aliveChannels }` (verified signed in, 2026-10-12; headers in
  github-web-mutations.md). GitHub's merge box shows its checks section when `statusRollup.summary` is non-empty.
  Not in this list, nor in the commit's status rollup ("Status checks: success") nor the PR's Checks tab: runs of
  GitHub's own `dynamic` workflows such as "Running Copilot Code Review" (Copilot's review agent). They appear only in
  the repository's Actions list (`/{o}/{r}/actions?query=branch:<head>`), where a failed one reads "Running Copilot Code
  Review failed: Copilot #N: by Copilot AI". Graphite counts such a failure as a non-required failing check (seen on
  acme/widgets#9003, 2026-10-12); GitHub's UI does not. `GET /{o}/{r}/actions?query=branch%3A<head>+event%3Adynamic`
  (HTML, newest run first; verified 2026-10-12, class names hashed) lists each run as an
  `<li aria-label="<status>: Run <n> of <workflow>. <title>">`, e.g. `failed: Run 2557 of Copilot. Running Copilot Code
  Review` (statuses seen: `failed`, `completed successfully`, `cancelled`), holding an
  `<a href="https://github.com/{o}/{r}/actions/runs/<runId>">` whose text is the title and a
  `<relative-time datetime="…">`. The row does not name the commit; the run's page, `GET /{o}/{r}/actions/runs/<runId>`,
  does in its title: `<title>Running Copilot Code Review · acme/widgets@9824bb7</title>` (7 or 40 hex
  characters after `@`). `dynamicWorkflowChecks` in `src/lib/github-web/actions.ts` reads both.
- `GET …/page_data/stack_mergeability?merge_method=MERGE&bypass_requirements=false` → stack entries:
  `[{ pull: { number, title, state, url, headBranch, headOid, isInAutoMergeRange, isUnstackable },
  position: 'CURRENT'|…, status: 'NEEDS_MERGE_STATE'|…, failedSubConditions, channels }]` (called for every
  PR of a native stack).
- `GET …/page_data/threads` → review threads. Thread shape (from the changes store):
  `{ id, subjectType: 'LINE', isResolved, resolvedBy, resolutionReason, viewerCanReply, pullRequestReviewId,
  reviewCommentsLimit, positioning: { path, startLine, endLine, startDiffSide: 'LEFT'|'RIGHT', endDiffSide,
  isOutdated }, commentsData: { comments: [{ id: 'PRRC_…', databaseId, author: { login, avatarUrl, isAgent },
  authorAssociation, body, bodyHTML, createdAt, publishedAt, currentDiffResourcePath, isHidden,
  minimizedReason, reactionGroups, reference: { number, author }, repository }] } }`. Stored per file as
  `markers[pathDigest]['R5' | 'L12'] = { threads: [...], annotations: [...] }`.
- `GET …/page_data/codeowners`.

### Changes page (`/{owner}/{repo}/pull/{n}/changes`; `/files` redirects here)
HTML embedded `payload.pullRequestsChangesRoute`:
```
diffSummaries: [{ path, pathDigest (sha256 hex), changeType: 'MODIFIED'|'ADDED'|'DELETED'|'RENAMED'|…,
  linesAdded, linesDeleted, linesChanged, markedAsViewed, isCodeowner, isVendored, isManifestFile, isSymlink,
  highestAnnotationLevel, markersMap }]
diffContents: [DiffEntry]            -- only the first file(s); the rest come from diff_entries
comparison: { fullDiff: { baseOid, headOid }, selectedRange, viewing: 'FULL' }
commits: [{ oid, shortOid, messageHeadline, actorLogin, createdAt }]
pageLimits: { filesLimit: 3000, linesChangedLimit: 10000, annotationsPaginatedLimit: 350, …Exceeded flags }
viewerPendingReview, codeowners, fileFilter, markers, urls, user, pullRequest, repository
```
`GET …/page_data/diff_entries?paths=<path1>,<path2>&ctx=:::&w=0&range=<redacted>` (paths are
`encodeURIComponent`-ed then joined with `,`, so `/` appears as `%252F` in the final URL) → `DiffEntry[]`:
```
{ path, pathDigest, status: 'MODIFIED'|…, isBinary, isTooBig, isSubmodule, truncatedReason, richDiff,
  linesAdded, linesDeleted, linesChanged, oldCommitOid, newCommitOid,
  oldTreeEntry: { path, mode, lineCount }, newTreeEntry: { path, mode, lineCount, isGenerated },
  diffLines: [{ type: 'HUNK'|'CONTEXT'|'ADDITION'|'DELETION'|…, blobLineNumber, position, left, right,
                text, html, displayNoNewLineWarning, problems: [] }] }
```
A unified patch for `@pierre/diffs` can be rebuilt from `diffLines` (HUNK lines are the `@@` headers; prefix
ADDITION with `+`, DELETION with `-`, CONTEXT with a space).

## Homepage's "Top repositories" (`/`, signed in) — classic HTML fragments (VERIFIED signed in 2026-10-13)
- `GET /dashboard/my_top_repositories?location=left` → an HTML fragment (no `<html>` wrapper; `DOMParser` reads it):
  `<h2 id="dashboard-top-repositories-heading">Top repositories</h2>`, `<a href="/new">New</a>`, then
  `<ul class="list-style-none js-dashboard-repos-list">` with one `<li>` per repository (seven on the first page):
  `li > div > a[href="/owner/name"] > img[src="https://avatars.githubusercontent.com/…"][alt="name"]` (the owner's
  avatar; its `src` carries a query string), then `div > a[href="/owner/name"] > span` reading `owner/name` (the slash in
  a span of its own, owner and name separate text pieces). Below the list, "Show more" is `<form class="ajax-pagination-form
  js-ajax-pagination js-more-repos-form" method="get" action="/dashboard/ajax_my_repositories?location=left">` with
  `<input type="hidden" name="repos_cursor" value="<integer>">`; `GET
  /dashboard/ajax_my_repositories?location=left&repos_cursor=<value>` answers the next page's `<li>`s in the same shape,
  with another such form while more remain (none on the last page). GitHub's own fragment loader sends
  `X-Requested-With: XMLHttpRequest`; `topRepositories` in `src/lib/github-web/repositories.ts` does too.

## Writes
Review submit, comment, inline comment, resolve, merge, auto-merge, viewed and draft: see
`github-web-mutations.md` (read from GitHub's bundles; none sent yet).
