# GitHub API reference for the extension (checked against the live schema on 2026-10-09)

Validated query files sit next to this doc: `inbox.graphql`, `prpage.graphql`, `stack.graphql`.
All queries were run read-only against public repos; no mutation was executed.

**Biggest finding: GitHub now has native stacked PRs** (public preview since ~2026-07-30).
`PullRequest.stack` and `PullRequest.stackEntry` are live. PRs in a Graphite-made stack return
`stack: null`. Order of preference: native fields → infer from branches → parse the Graphite comment.

## 0. Headers (verified)
- GraphQL: `POST https://api.github.com/graphql`, `Authorization: Bearer <PAT>`, `Content-Type: application/json`,
  optional `X-Github-Next-Global-ID: 1` (send it so IDs stay stable).
- No preview `Accept` header is needed for `mergeStateStatus`. No `GraphQL-Features` header needed.
- REST: `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`.

## 1. Inbox (verified; cost 3 points per 50-result section — alias several sections into one request)
See `inbox.graphql`. Per PR: `id number title url isDraft state isReadByViewer createdAt updatedAt
author{login avatarUrl} repository{nameWithOwner} headRefName baseRefName reviewDecision mergeable
mergeStateStatus additions deletions changedFiles totalCommentsCount stackEntry{position}
stack{number size} labels(first:10) reviewRequests(first:10){nodes{asCodeOwner requestedReviewer{
__typename ...on User{login avatarUrl} ...on Team{slug combinedSlug name} ...on Bot{login avatarUrl}
...on Mannequin{login avatarUrl}}}} latestOpinionatedReviews(first:10, writersOnly:true){nodes{state
submittedAt author{login avatarUrl}}} latestReviews(first:10){...} commits(last:1){nodes{commit{oid
statusCheckRollup{state contexts(first:50){totalCount checkRunCountsByState{state count}
statusContextCountsByState{state count} nodes{__typename ...on CheckRun{name status conclusion
detailsUrl title} ...on StatusContext{context state targetUrl description}}}}}}}`.

Notes:
- `isReadByViewer` exists (nullable Boolean); unverified whether it matches the web UI's unread dot.
- `latestOpinionatedReviews(writersOnly:true)` holds only APPROVED / CHANGES_REQUESTED from writers (drives `reviewDecision`). `latestReviews` also includes COMMENTED.
- `RequestedReviewer` can also be `EnterpriseTeam`.
- `mergeable` can be `UNKNOWN` while GitHub computes it; refetch later.
- `isRequired` takes `pullRequestNumber:` so it cannot be used inside search results; use it on the PR page.
- Search returns at most 1,000 results; `first` is 1–100.
- GraphQL `search` does NOT consume the REST search bucket (30/min). Secondary limits still apply.
- `SearchType` also has `ISSUE_ADVANCED` (AND/OR/parentheses; `repo:`/`org:` are ANDed there, ORed under `ISSUE`).

## 2. Search strings (`@me` works inside the GraphQL search string; case-insensitive)
| Need | Query |
|---|---|
| My review requested (directly or via team) | `is:pr is:open archived:false review-requested:@me` |
| Requested from me directly only | `user-review-requested:@me` |
| Requested via a team | `team-review-requested-user:@me`, or `team-review-requested:ORG/TEAM` |
| Keep PRs I already reviewed / was re-requested on | `review-involves:@me` (`review-requested` drops a PR once you review it) |
| Authored by me | `author:@me` |
| Review state | `review:approved`, `review:changes_requested`, `review:none`, `review:required` |
| Draft | `draft:true` / `draft:false` |
| Recently merged | `is:pr is:merged merged:>=2026-10-01` |
| Reviewed by me | `reviewed-by:@me -author:@me` |
| Involves me | `involves:@me` |
| Scope | `org:ORG`, `repo:OWNER/NAME`, `user:LOGIN`, `archived:false` |
| Sort | `sort:updated-desc` |

## 3. PR page (verified on cli/cli#14580, cost 2 points) — see `prpage.graphql`
Repository: `id nameWithOwner viewerPermission viewerDefaultMergeMethod mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed autoMergeAllowed`.
PR: `id number title url body bodyHTML state isDraft locked createdAt updatedAt closedAt mergedAt author headRefName headRefOid baseRefName baseRefOid headRepository{nameWithOwner} baseRef{name target{oid}} isCrossRepository mergeable mergeStateStatus reviewDecision isInMergeQueue autoMergeRequest{enabledAt mergeMethod enabledBy{login}} viewerCanUpdate viewerDidAuthor viewerCanEnableAutoMerge viewerCanDisableAutoMerge viewerCanMergeAsAdmin viewerCanUpdateBranch viewerLatestReview{id state submittedAt} additions deletions changedFiles stack{number size baseRefName} stackEntry{position} labels assignees reviewRequests latestOpinionatedReviews(first:20, writersOnly:true) commits(last:1){totalCount nodes{commit{oid statusCheckRollup{state contexts(first:100){... CheckRun{name status conclusion detailsUrl title startedAt completedAt isRequired(pullRequestNumber:$number) checkSuite{app{name slug} workflowRun{workflow{name}}}} StatusContext{context state targetUrl description avatarUrl isRequired(pullRequestNumber:$number)}}}}}}`
`reviewThreads(first:100){nodes{id isResolved isOutdated isCollapsed path line startLine originalLine originalStartLine diffSide startDiffSide subjectType viewerCanResolve viewerCanUnresolve viewerCanReply resolvedBy{login} comments(first:50){nodes{id author body bodyHTML createdAt path line originalLine startLine outdated diffHunk url replyTo{id} pullRequestReview{id state}}}}}`
`timelineItems(first:100, itemTypes:[ISSUE_COMMENT, PULL_REQUEST_REVIEW, REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT, READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, MERGED_EVENT, CLOSED_EVENT, REOPENED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT, BASE_REF_CHANGED_EVENT, PULL_REQUEST_COMMIT, REVIEW_DISMISSED_EVENT])` with the fragments in the file.

Schema notes:
- `PullRequestReviewComment.position`/`originalPosition` are deprecated; use `line`, `startLine`, `originalLine`, `originalStartLine`. Outdated threads have `line: null` → render from `originalLine` + `diffHunk`.
- `databaseId` deprecated in favour of `fullDatabaseId`.
- Other timeline types exist: `ADDED_TO_STACK_EVENT`, `REMOVED_FROM_STACK_EVENT`, `AUTO_MERGE_ENABLED_EVENT`, `ADDED_TO_MERGE_QUEUE_EVENT`.
- Per-file viewed state is GraphQL-only, max 100 per page:
  `pullRequest(number:$n){ files(first:100, after:$c){ totalCount pageInfo{hasNextPage endCursor} nodes{ path additions deletions changeType viewerViewedState } } }`
  `changeType` ∈ ADDED, DELETED, RENAMED, COPIED, MODIFIED, CHANGED; `viewerViewedState` ∈ VIEWED, UNVIEWED, DISMISSED.

## 4. Files and diff
- Per-file patches: `GET /repos/{o}/{r}/pulls/{n}/files?per_page=100&page=N`, follow the `Link` header; at most 3,000 files. Items: `sha filename status additions deletions changes blob_url raw_url contents_url patch? previous_filename?`. Diff is three-dot (merge base → head). `patch` is omitted for binary files and files over the per-file limit (20,000 lines / 500 KB): treat missing `patch` with `changes > 0` as "too large or binary". `per_page=100` returned `patch` on all 100 files of a 157-file PR.
- Whole diff: `GET /repos/{o}/{r}/pulls/{n}` with `Accept: application/vnd.github.diff` (limits 300 files / 20,000 lines / 1 MB; over the limit returns 406 → fall back to `/files`).
- Full file contents: REST `GET /repos/{o}/{r}/contents/{path}?ref={sha}` with `Accept: application/vnd.github.raw+json`; or GraphQL
  `repository{ head: object(expression:"<headRefOid>:path"){ ...on Blob{ oid byteSize isBinary isTruncated text } } base: object(expression:"<mergeBase>:path"){...} }`.
  The old side should be the merge base: `GET /repos/{o}/{r}/compare/{baseRefOid}...{headRefOid}` → `.merge_base_commit.sha`. Use `previous_filename` for renames.

## 5. Stacks
A) Native (verified, read-only in GraphQL):
```graphql
query NativeStack($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) { pullRequest(number:$number) {
    stackEntry { position }
    stack { id number size baseRefName entries(first: 50) { nodes { position pullRequest { number title url state isDraft headRefName baseRefName reviewDecision } } } }
  } }
}
```
Position 1 is closest to the base branch. A native stack merges atomically and cannot use plain `mergePullRequest`.

B) Infer from branches (both `headRefName` and `baseRefName` args exist on `Repository.pullRequests`; `states` takes a list):
```graphql
query StackNeighbours($owner: String!, $name: String!, $head: String!, $base: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    below: pullRequests(headRefName: $base, states: [OPEN, MERGED], first: 5, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { number title url state isDraft headRefName baseRefName reviewDecision } }
    above: pullRequests(baseRefName: $head, states: OPEN, first: 10, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { number title url state isDraft headRefName baseRefName reviewDecision } }
  }
}
```
Walk `below` until `baseRefName == defaultBranchRef.name`; `above` can return several PRs (stacks branch). For repos with few open PRs, fetch `pullRequests(states: OPEN, first: 100){ nodes { number headRefName baseRefName } }` once and build the graph client-side.

C) Graphite stack comment (observed 2026-10): an `IssueComment` posted by the user who ran `gt submit` (not a bot) — detect by body. Shape:
```
* **#4540** <a href="https://app.graphite.com/github/pr/OWNER/REPO/4540?..."><img .../></a> 👈 <a ...>(View in Graphite)</a>
* **#4538** <a href="..."><img .../></a>
* `staging`
<hr />
This stack of pull requests is managed by <a href="https://graphite.dev?utm-source=stack-comment"><b>Graphite</b></a>. ...
<!-- Current dependencies on/for this PR: -->
```
List runs top of stack → bottom, trunk last in backticks, 👈 marks the current PR. Parse with `/^\* \*\*#(\d+)\*\*(.*👈)?/gmu` and ``/^\* `([^`]+)`\s*$/m``. Marker strings: `This stack of pull requests is managed by`, `<!-- Current dependencies on/for this PR: -->`. Some comments list already-merged PRs below the current one; check each PR's state.

## 6. Mutations (inputs from introspection; none executed)
```graphql
mutation SubmitReview($prId: ID!, $event: PullRequestReviewEvent!, $body: String, $commitOID: GitObjectID, $threads: [DraftPullRequestReviewThread]) {
  addPullRequestReview(input: {pullRequestId: $prId, event: $event, body: $body, commitOID: $commitOID, threads: $threads}) { pullRequestReview { id state url submittedAt } }
}
# DraftPullRequestReviewThread = { path, line, side: LEFT|RIGHT (default RIGHT), startLine?, startSide?, body! }
mutation StartReview($prId: ID!) { addPullRequestReview(input: {pullRequestId: $prId}) { pullRequestReview { id state } } }
mutation AddThread($reviewId: ID, $prId: ID, $path: String!, $line: Int, $side: DiffSide = RIGHT, $startLine: Int, $startSide: DiffSide, $body: String!, $subjectType: PullRequestReviewThreadSubjectType = LINE) {
  addPullRequestReviewThread(input: {pullRequestReviewId: $reviewId, pullRequestId: $prId, path: $path, line: $line, side: $side, startLine: $startLine, startSide: $startSide, body: $body, subjectType: $subjectType}) { thread { id path line diffSide isResolved comments(first: 1) { nodes { id url } } } }
}
mutation Reply($threadId: ID!, $body: String!, $reviewId: ID) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body, pullRequestReviewId: $reviewId}) { comment { id url bodyHTML createdAt } } }
mutation SubmitPending($reviewId: ID!, $event: PullRequestReviewEvent!, $body: String) { submitPullRequestReview(input: {pullRequestReviewId: $reviewId, event: $event, body: $body}) { pullRequestReview { id state url } } }
mutation DiscardPending($reviewId: ID!) { deletePullRequestReview(input: {pullRequestReviewId: $reviewId}) { pullRequestReview { id } } }
mutation Resolve($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id isResolved resolvedBy { login } } } }
mutation Unresolve($threadId: ID!) { unresolveReviewThread(input: {threadId: $threadId}) { thread { id isResolved } } }
mutation Merge($prId: ID!, $method: PullRequestMergeMethod = SQUASH, $expectedHeadOid: GitObjectID!, $headline: String, $body: String) {
  mergePullRequest(input: {pullRequestId: $prId, mergeMethod: $method, expectedHeadOid: $expectedHeadOid, commitHeadline: $headline, commitBody: $body}) { pullRequest { id state merged mergedAt mergeCommit { oid } } }
}
mutation Comment($subjectId: ID!, $body: String!) { addComment(input: {subjectId: $subjectId, body: $body}) { commentEdge { node { id url bodyHTML createdAt author { login } } } } }
mutation Viewed($prId: ID!, $path: String!)   { markFileAsViewed(input: {pullRequestId: $prId, path: $path})   { pullRequest { id } } }
mutation Unviewed($prId: ID!, $path: String!) { unmarkFileAsViewed(input: {pullRequestId: $prId, path: $path}) { pullRequest { id } } }
mutation AutoMerge($prId: ID!, $method: PullRequestMergeMethod = SQUASH, $expectedHeadOid: GitObjectID) { enablePullRequestAutoMerge(input: {pullRequestId: $prId, mergeMethod: $method, expectedHeadOid: $expectedHeadOid}) { pullRequest { id autoMergeRequest { enabledAt mergeMethod } } } }
mutation NoAutoMerge($prId: ID!) { disablePullRequestAutoMerge(input: {pullRequestId: $prId}) { pullRequest { id autoMergeRequest { enabledAt } } } }
mutation Ready($prId: ID!)   { markPullRequestReadyForReview(input: {pullRequestId: $prId}) { pullRequest { id isDraft } } }
mutation ToDraft($prId: ID!) { convertPullRequestToDraft(input: {pullRequestId: $prId})     { pullRequest { id isDraft } } }
```
- `mergeMethod` defaults to `MERGE`; always pass it.
- `updatePullRequest` has no `isDraft`; use the two draft mutations. `requestReviews {pullRequestId!, userIds, teamIds, botIds, union}`. `updatePullRequestBranch {pullRequestId!, expectedHeadOid, updateMethod MERGE|REBASE}`.
- Unverified: `addPullRequestReviewThread` with only `pullRequestId` (no pending review). Use the explicit `reviewId` flow.

## 7. Auth and rate limits
- Classic PAT: `repo` + `read:org` (teams, team review requests). SAML orgs need the token SSO-authorised per org.
- Fine-grained PAT: Pull requests read/write, Contents read (**write to merge**), Metadata read, Commit statuses read; org Members read for teams. One resource owner per token → cannot cover several orgs; no outside-collaborator repos; docs say fine-grained PATs cannot call the Checks API (unverified effect on `CheckRun` nodes).
- Limits: GraphQL 5,000 points/h, secondary 2,000 points/min (query 1, mutation 5); 100 concurrent; 10 s timeout. REST 5,000/h; REST search 30/min; content creation 80/min, 500/h. Measured: inbox 3 points per 50-result section; PR page 2 points.

## 8. CORS (verified with curl)
- Preflight on `/graphql` and REST with `Origin: https://github.com` → 204, `access-control-allow-origin: *`, allowed headers include `Authorization, Content-Type, GraphQL-Features, X-Github-Next-Global-ID, X-GitHub-Api-Version`; exposed headers include `Link, ETag, X-RateLimit-*, X-OAuth-Scopes`. github.com's CSP `connect-src` includes `api.github.com`.
- A content script can call api.github.com directly; an MV3 service worker with `host_permissions: ["https://api.github.com/*"]` bypasses CORS entirely. Recommendation: keep the PAT in the service worker and make calls there.

## Still unverified
`isReadByViewer` vs web unread dot; `Blob.text` truncation size; 406 diff error body; exactly when `patch` is omitted; fine-grained PAT visibility of CheckRun nodes; SAML behaviour in GraphQL; `addPullRequestReviewThread` without a review ID; whether the operator/length limits apply to GraphQL search.
