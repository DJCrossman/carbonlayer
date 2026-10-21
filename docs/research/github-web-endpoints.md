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

`error` is null for a search GitHub ran. A search it will not run still answers **200**, with `results: []`,
`totalCount: 0` and `error` a string saying why: `"The search query contains invalid syntax."` (unbalanced
parentheses, an empty `()`), or `"\"{{7d}}\" is not a recognized date/time format. Please provide an ISO 8601
date/time value, such as YYYY-MM-DD."`. An unknown qualifier (`bogus:thing`) is no error: 0 rows, `error: null`.
`(repo:a OR repo:b …) <query>` searches any of 1 to 40 repositories (some 1.4k characters of query), nested groups
included (`(repo:a OR repo:b) is:pr is:open ((author:@me OR assignee:@me) OR review-requested:@me)`); bare repeated
`repo:a repo:b` AND, so match nothing. `/pulls/deferred?q=` answers 200 for those scoped queries too. (VERIFIED signed in
2026-10-14, read-only.)

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

Data endpoints (all `page_data/*` need a session; `tab_counts`, `diffstat` and `header` also work signed out):
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
  In a native stack, `mergeRequirements` (beside `pullRequest`) has a STACK condition whose `entries` are
  `[{ pull: { number, state, headOid, headBranch, title, url, isInAutoMergeRange, isUnstackable }, position:
  'AFTER'|'CURRENT'|'BEFORE', status, failedSubConditions }]` (verified signed in on offstreetparking/core#9265, the top
  of a four-PR stack with auto-merge off, 2026-10-21: every entry `isInAutoMergeRange: false`). GitHub marks each PR that
  auto-merge, once on for the stack, merges when they all meet the requirements; `mergeState` reads them as
  `autoMergeRange`, and the stack card's rows for them read "will merge when ready".
- `GET …/page_data/header` → `{ pullRequest: { author, baseBranch, headBranch, headRepositoryOwnerLogin,
  headRepositoryName, headSha, number, state, … }, stack, … }`, lighter than the merge box. A PR from a fork has a head
  repository other than its own, whose head branch says nothing about this repository's stacks. `pr.merge` reads
  `headSha` here to refuse a merge after a push; "Group by stack" reads the branches (`branchesIn` in
  `src/lib/github-web/inbox.ts`). `pullRequest.author` is `{ isAgent, slug, login, displayName, avatarUrl }`
  (verified signed in, 2026-10-14, with the React headers `getJson` sends): the stack card reads who opened each other
  entry here (`authorIn` in `src/lib/github-web/stack.ts`), because `stack.pulls[]` entries carry exactly
  `{ isInAutoMergeRange, isUnstackable, title, number, state, url, headBranch, headOid }` and no author (verified the
  same day).
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
- `GET …/page_data/stack_mergeability?merge_method=SQUASH&bypass_requirements=false` → one PR's verdict as an entry of
  its native stack, an object, not a list: `{ state: 'MERGEABLE', effectiveEntryStatus: 'READY', isInAutoMergeRange:
  false, channels: {…}, statusCheckChannels: {…} }` (verified with a read-only GET, with the React headers `getJson`
  sends, in David's signed-in session, 2026-10-15: both PRs of a two-PR stack, the top one and the one below it, answered
  `MERGEABLE` / `READY`; GitHub's page then said "Able to merge as a stack"). Each PR is asked at its own URL: GitHub's
  merge box asks it for every entry its `STACK` condition lists as `status: 'NEEDS_MERGE_STATE'` (that condition's
  `entries` are the `[{ pull: { number, url, state, … }, position: 'BEFORE'|'CURRENT'|'AFTER', status, failedSubConditions }]`
  once recorded here as this route's answer). From GitHub's bundle: `effectiveEntryStatus` is one of `READY`,
  `NOT_READY`, `BLOCKED_DOWNSTACK`, `DRAFT`, `CLOSED`, `MERGE_CONFLICTS`, `NEEDS_REBASE`, `MERGED`, `MERGING`, `QUEUED`,
  `LOADING`, `AFTER` (the page computes the last four itself too, and reads a missing one as `NOT_READY`); `state` is the
  merge requirements' state, as in the merge box: `MERGEABLE`, `MERGEABLE_IF_STATUSES_PASS`, `UNMERGEABLE`, `UNKNOWN`.
  `resolveStack` in `src/lib/github-web/stack.ts` asks each open PR from the bottom of the stack up to the viewed one
  and counts only `READY` as ready to merge as a stack.
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
`encodeURIComponent`-ed then joined with `,`, so `/` appears as `%252F` in the final URL) → `DiffEntry[]` (VERIFIED
2026-10-19 on GitHub's own changes page's request, offstreetparking/core#9188 with `?gh=1`: an object keyed by the entries'
places, `{ "0": entry }`; `fileDiffs` reads either):
```
{ path, pathDigest, status: 'MODIFIED'|…, isBinary, isTooBig, isSubmodule, truncatedReason, richDiff,
  linesAdded, linesDeleted, linesChanged, oldCommitOid, newCommitOid,
  oldTreeEntry: { path, mode, lineCount }, newTreeEntry: { path, mode, lineCount, isGenerated },
  diffLines: [{ type: 'HUNK'|'CONTEXT'|'ADDITION'|'DELETION'|…, blobLineNumber, position, left, right,
                text, html, displayNoNewLineWarning, problems: [] }] }
```
A unified patch for `@pierre/diffs` can be rebuilt from `diffLines` (HUNK lines are the `@@` headers; prefix
ADDITION with `+`, DELETION with `-`, CONTEXT with a space).

Lines GitHub holds back (VERIFIED read-only 2026-10-19 on GitHub's own changes pages, `?gh=1`): an entry's keys are
`isBinary, isSubmodule, isTooBig, diffLines, linesAdded, linesChanged, linesDeleted, oldCommitOid, newCommitOid,
oldTreeEntry, newTreeEntry, path, pathDigest, richDiff, submodule, status, truncatedReason, diffSize`. On
offstreetparking/core#9188, `apps/dashboard/tests/docker/shard-timings.json` (ADDED, +5370, `linguist-generated=true` in
`.gitattributes`) and `pnpm-lock.yaml` (MODIFIED, +10) both came with `isBinary: false`, `isTooBig: false`,
`truncatedReason: null`, `diffSize: ""` and `diffLines: []`: GitHub leaves out a generated file's lines (lockfiles and
linguist-generated files) whatever its size. Its page shows "Load Diff" over "Some generated files are not rendered by
default. Learn more about customizing how changed files appear on GitHub.", and renders such files as regions filled as
they come into view ("Loading <path>"). On offstreetparking/core#9190, a deleted file
(`…/reads/envelope-rollup.test.ts`, the summaries' `changeType: "REMOVED"`, −437) came with `status: "REMOVED"`,
`diffLines: []`, `linesDeleted: 437`, `isTooBig: true`, `truncatedReason: null`: GitHub marks every deleted file too big,
small or not, and its page shows it collapsed to "Load Diff" over "This file was deleted.". The reader calls such a file
`held-back` (`isTooBig`, or no `diffLines` while lines were added or deleted) and a binary one `binary` (`diffOf` in
`src/lib/github-web/files.ts`), and reads `newTreeEntry.isGenerated` for the "Generated" tag (VERIFIED 2026-10-20 on #9188:
`newTreeEntry: { mode, path, lineCount, isGenerated }` is `isGenerated: true, lineCount: 5370` for shard-timings.json and
`true, 27110` for pnpm-lock.yaml, `false, 154` for apps/dashboard/package.json, which came with its 21 lines). UNVERIFIED: an entry `isTooBig: true` for its size alone (no example at hand; GitHub's page shows "Large
diffs are not rendered by default" with "Load diff", assumed to send the same request as below); a pure rename's entry (no
example at hand: read as whatever it is, the page asking nothing for a rename with no lines added or deleted, and showing
"File renamed without changes.", wording not checked against GitHub's); and the wording for a binary file, "Binary file
not shown", which is GitHub's as remembered, not seen today.

The unchanged lines a file's diff leaves out (VERIFIED read-only in a signed-in session, 2026-10-19, on GitHub's own
changes page for offstreetparking/core#8986 with `?gh=1`): between hunks, above the first and below the last, GitHub's
buttons read "Expand file up from line 3", "Expand file down from line 24", "Expand file from line 6 to line 11", "Expand
file up from line 58", "Expand file down from line 58". "Expand file from line 6 to line 11" asked
`GET …/page_data/diff_entry_lines?path=<file path>&context_line_ranges[]={"start":7,"end":10}&w=0&range=<head OID>` with the
React JSON headers `getJson` sends: `context_line_ranges[]` is a URL-encoded JSON object, an array parameter (several
ranges may go in one request), `w` the whitespace setting (0 shows it), `range` the 40-hex head commit (it equalled the
merge box's `pullRequest.headRefOid`). The answer, 200:
```
{ diffEntryLines: [{ type: 'HUNK'|'CONTEXT'|'DELETION'|…, blobLineNumber, position, displayNoNewLineWarning, text, html,
                     left, right, problems: [] }] }
```
is the file's whole diff entry again with the lines asked for merged in as **INJECTED_CONTEXT** lines whose `text` starts
with `~` (VERIFIED 2026-10-19: asking 7–10 of `.github/scripts/teardown-stall.sh` added `INJECTED_CONTEXT L6 R7 "~…"` …
`L9 R10`; the same request without ranges answers only HUNK/CONTEXT/DELETION/ADDITION, 53 entries). The diff's own
lines: the first `{ type: 'HUNK', text: '@@ -1,15 +1,19 @@', left: 0, right: 0 }`, then e.g. `{ type: 'CONTEXT', text:
' #!/usr/bin/env bash', left: 1, right: 1 }`, `{ type: 'DELETION', text: '-# Tears down…', left: 2, right: 1 }`,
`{ type: 'ADDITION', left: 2, right: 2 }`: `text` keeps its diff marker, `left` / `right` number the line in the old /
new file (a removed line's `right` and an added line's `left` repeat the neighbouring number; neither is read). Also
VERIFIED: the ranges are the new file's line numbers (7–10 came back as R7–R10), and a range running past the end of the
file answers 200 with the entry as far as the file goes. `expandedDiffLines` in `src/lib/github-web/files.ts`
asks it (`pr.fetchDiffLines`), and the PR page asks every range a file's diff hides in one request on the first expand
(`hiddenLines` in `src/pr/diff.ts`), since `@pierre/diffs` expands lines only once it has the whole file on both sides.
UNVERIFIED: which path a renamed file is asked by (the new one is sent); any line type other than the five above is
left out, and a side left a line short fails the expand, naming the line. Whether GitHub takes a review comment on an
expanded line is not known either: the page offers none.

"Load Diff" on a held-back file (VERIFIED 2026-10-19, `apps/dashboard/tests/docker/shard-timings.json` on
offstreetparking/core#9188): `GET …/page_data/diff_entry_lines?path=<path>&w=0&range=<head OID>`, no
`context_line_ranges[]`, answered 200 with 107,764 bytes: the file's whole diff entry, `{ diffEntryLines: [...] }`, lines of
the shape above (HUNK / CONTEXT / DELETION / ADDITION with `left`, `right`, `text`). The page asks the same for a file it
calls `held-back` (`pr.fetchDiffLines` with no ranges, `prHeldBackDiffQuery` in `src/pr/page-data.ts`) and makes its patch
with `patchOf`. UNVERIFIED: that a deleted file's "Load Diff" and a too-big file's "Load diff" send the same request (the
path of a deleted file, which the head commit no longer has, is sent as it is).

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

## An organization's people (`/orgs/<login>/people`, signed in) — classic HTML page (VERIFIED signed in 2026-10-14)
- `GET /orgs/<login>/people` (`Accept: text/html`) → 200, the whole People page. Each member is
  `<li class="… member-list-item js-bulk-…" data-bulk-actions-id="<user id>">` holding
  `<a class="d-inline-block" data-hovercard-type="user" data-hovercard-url="/users/<login>/hovercard" href="/<login>">
  <img class="avatar avatar-user" src="https://avatars.githubusercontent.com/…" alt="@<login>"></a>` and
  `<a class="f4 d-block" id="member-<login>" data-test-selector="linked-name-is-full-if-exists" href="/<login>">` reading
  the member's name, or their login again when they gave none.
- A 14-member organization listed all 14 on the one page, with no pagination links. How a bigger organization pages is
  UNVERIFIED: `organizationPeople` (`src/lib/github-web/people.ts`) assumes GitHub's classic `a[rel="next"]` link to
  `?page=N` of the same page and follows it, ten pages at most. `?query=<text>` filters server-side (`?query=da` returned
  one row); not used.
- The viewer's own account is no organization and has no People page; nothing is asked for it.
- Not this: `GET /autocomplete/users?q=` answers `text/fragment+html` `li.autocomplete-item[data-autocomplete-value=<login>]`
  from all of GitHub, not the organization's people.

## The emoji a comment box suggests (`/autocomplete/emojis_for_editor`) — JSON (VERIFIED signed in 2026-10-15)
- `GET /autocomplete/emojis_for_editor` with `Accept: application/json` and the React headers `getJson` sends → 200, one
  JSON object of 1936 entries: every emoji GitHub's React markdown editor suggests after a `:`, by name. One of Unicode's
  is `name → [imageUrl, character]` (`"+1": ["https://github.githubassets.com/images/icons/emoji/unicode/1f44d.png?v8",
  "👍"]`, `"smile": [".../unicode/1f604.png?v8", "😄"]`), one of GitHub's own `name → [imageUrl]` (`shipit`, `octocat`,
  `atom`, `basecamp`, `bowtie`, `copilot`, `dependabot`, `electron`, `feelsgood`, `finnadie`, `fishsticks`, `goberserk`,
  `godmode`, `hurtrealbad`, `neckbeard`, `rage1` … `rage4`, …). Its first keys, in order: `100`, `1234`, `+1`, `-1`,
  `1st_place_medal`, `2nd_place_medal`. A plain navigation to it gets 406.
- GitHub's editor (its bundles, read 2026-10-15) suggests them as Primer's `InlineAutocomplete` with
  `{ triggerChar: ':', keepTriggerCharOnCommit: false }`: a `:` at the start of the text or after whitespace opens the
  list for what follows it up to the caret. Each emoji scores 5 when its name has the query, case aside, and 5 more when
  it begins with it; none scoring nothing. The highest five, `+1`, `thumbsup` and `-1` ahead of their equals, else in
  the list's order, then those three ahead of the rest of the five; a bare `:` lists the first five. Enter or Tab puts the
  one selected in place of the `:` and the query, with a space after it: the character, or `:name:` for one of GitHub's
  own. A typed `:+1:` stays as it is; GitHub renders it. `markdown.emojis` reads the list (`src/lib/github-web/index.ts`),
  and `emojiQueryAt`, `emojiSuggestionsFor` and `insertEmoji` in `src/pr/markdown-editing.ts` do the rest.

## Writes
Review submit, comment, inline comment, resolve, merge, auto-merge, viewed and draft: see
`github-web-mutations.md` (read from GitHub's bundles; none sent yet).
