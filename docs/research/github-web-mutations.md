# GitHub React PR page: same-origin requests (from the public JS bundles, 2026-10-09; nothing was sent)

Every PR action is a same-origin JSON `fetch` to `P = /{owner}/{repo}/pull/{n}/page_data/<route>`, except
"viewed" which uses `/{owner}/{repo}/pull/{n}/file_review`, and reactions, still a classic form (see Reactions below).
No Relay / persisted-query ids and, reactions aside, no `authenticity_token` are involved. Route names are plain strings in one enum (module `UT` in
`4t-c2bbc4f2c8ef0b83.js`); chunk hashes change with every deploy, the route names are the contract.

## Headers (seen in the bundle and in a captured request)
- `Accept: application/json`, `Content-Type: application/json`, body `JSON.stringify(body)`.
- `GitHub-Verified-Fetch: true`, `GitHub-Is-React: true`, `X-Requested-With: XMLHttpRequest`.
- `X-Fetch-Nonce`: value of `<meta name="fetch-nonce">` (looks like `v2:…`); refreshed from each response's
  `X-Fetch-Nonce` header. `X-GitHub-Client-Version`: value of `<meta name="release">`.
- Same-origin credentials (cookies). No CSRF token; the page has no `csrf-token` meta. INFERRED: the server
  checks these headers plus `Origin`/`Sec-Fetch-Site`; a content-script fetch carries the page origin.
- Error shape `{ error, metadata: { ruleErrors } }`; a `stale` field means the content changed underneath.

## Mutations (bodies read from the code; server acceptance INFERRED)
1. **Submit review**: `PUT P/submit_review` `{ body, event, headSha }`, `event` ∈ `"approve" | "comment" |
   "request changes"` (lowercase, with a space), `headSha` = PR head OID → `{ redirectUrl }`. Publishes any
   pending inline comments. Discard pending: `DELETE P/abandon_review`.
2. **PR comment**: `POST P/create_timeline_comment` `{ text }` → `{ issueComment, commentId }`.
3. **Inline comment**: `POST P/create_review_comment`, body always has
   `{ text, submitBatch, comparisonStartOid, comparisonEndOid }` plus
   - single line: `{ subjectType: "line", path, line, side: "left"|"right", positioning: { type: "line",
     baseCommitOid, headCommitOid, path, line, commitOid } }` (`commitOid` = base OID for left, head OID for right)
   - multi-line: `{ subjectType: "multiline", path, line: <end>, side: <endSide>, startLine, startSide,
     positioning: { type: "multiline", baseCommitOid, headCommitOid, startPath, startLine, startCommitOid,
     endPath, endLine, endCommitOid } }`
   - file: `{ subjectType: "file", path }`
   - reply: `{ text, submitBatch, inReplyTo: <last comment databaseId>, path, comparisonStartOid, comparisonEndOid }`
   `submitBatch: false` = add to the pending review; `true` = post immediately. → `{ thread: { id, … }, comment: { databaseId, … } }`.
   Resolve: `POST P/resolve_thread` `{ threadId, resolution_reason? }`; unresolve: `POST P/unresolve_thread`
   `{ threadId }` (`threadId` is the numeric string `threads[].id`). Edit: `PUT P/update_review_comment` `{ body, commentId }`.
   Delete: `DELETE P/review_comments/{databaseId}`.
4. **Merge**: `POST P/merge` `{ mergeMethod: "MERGE"|"SQUASH"|"REBASE", commitTitle, commitMessage,
   bypassBranchProtections: bool, authorEmail? }` (no head-SHA guard). Update branch: `POST
   P/update_pull_request_branch` `{ updateMethod, expectedHeadOid }`. Stack rebase: `POST P/stack_rebase`
   `{ expectedHeadOids: { "<number>": "<headOid>" } }`. Auto-merge on: `POST P/enable_auto_merge`
   `{ mergeMethod, commitTitle, commitMessage, authorEmail? }` (merge-queue repos: `{ mergeMethod: "SOLO"|"GROUP" }`);
   off: `POST P/disable_auto_merge`. Leave queue: `POST P/dequeue_pull_request`. Native stacks: `POST
   P/enqueue_stack` with `{ mergeAction: "DIRECT_MERGE", mergeMethod, commitTitle, commitMessage, authorEmail?,
   bypassRules: "true"|"false" }` | `{ mergeAction: "MERGE_QUEUE" }` | `{ mergeAction: "AUTO_MERGE", … }` →
   `{ status, uuid }`; poll `GET P/merge_request_status/{uuid}` (1 s backoff ×1.5, 10 min cap) until
   `merged` | `enqueued` | `failed`. GitHub's "Squash and merge stack [N]" sends `DIRECT_MERGE` from the PR viewed (its
   own page data URL), which merges it and every open PR below it: N counts them, this one included (the stack's entries
   neither above it nor merged or queued), and its stack section says "Merging this pull request will also merge N − 1
   pull requests below it" (read from the bundle, 2026-10-15).
5. **Viewed**: `POST /{owner}/{repo}/pull/{n}/file_review` `{ path, viewed: "viewed" }`; unviewed: `DELETE`
   same URL `{ path, _method: "delete" }`. Current state: `base_comparison_info` → `diffSummaries[].markedAsViewed`.
6. **Draft**: `POST P/convert_to_draft` (no body); ready: `POST P/mark_ready_for_review` (optional body).

## GET endpoints
Returned 200 signed out (curl), keys confirmed:
- `tab_counts`, `diffstat` (see github-web-endpoints.md).
- `threads[?after=cursor]`: `{ threads: [{ id, subjectType, isResolved, resolvedBy, resolutionReason,
  viewerCanReply, commentsData: { comments: [{ databaseId, id, body, bodyHTML, bodyVersion, reviewId, state, … }] },
  pullRequestReviewId }], aliveChannel }`. **Positions are not here**; they are in
  `base_comparison_info.markers.threads`.
- `codeowners`: `{ isEnabled, ownershipByPath: { path: { owners, ruleUrl, … } } }`.
- `file_tree`: `{ baseRefOid, commits[], diffs[], pathName, … }`.
- `base_comparison_info?range=…`: `{ comparison: { fullDiff: { baseOid, headOid } }, diffSummaries,
  diffContents, markers, viewerPendingReview: { id, comments }, user: { viewedFilesCount, … } }`.
- `review_menu?threadIds[]=`: `{ viewerPermission, …, threads }`.
- `diff_entry_lines?path=&context_line_ranges[]=<json>&w=&range=`: `{ diffEntryLines }`.
- Also 200: `review_requests`, `stacks`, `conversation_comments`, `timeline`, `header`, `description`,
  `participants`, `labels`, `assignees`, `development`, `deployments`, `code_button`, `annotations?end_commit_oid=`.
- **Revert a merged PR** (read from GitHub's PR bundle, `RevertPRAction`, 2026-10-14; not yet sent): an empty
  `POST /{owner}/{repo}/pull/{n}/revert` through `verifiedFetch` (`GitHub-Verified-Fetch`, `GitHub-Is-React`,
  `X-Requested-With`, `X-Fetch-Nonce`, `X-GitHub-Client-Version`), no body. GitHub's UI ignores the answer's body, follows
  the redirect and sends the browser to `response.url`, labelled "Opening revert pull request"; that is presumably the
  prefilled compare page for the `revert-<n>-<head branch>` branch (title `Revert "<title>"`, body `Reverts <owner>/<repo>#<n>`),
  unseen signed in. GitHub shows the button for MERGED PRs when the overview route's `user.canRevert` is true; the
  layout route has no such flag, so CarbonLayer shows it to viewers who can edit the PR and lets GitHub refuse the rest.
Need a session (404 signed out): `status_checks`, `merge_box`, `stack_mergeability`, `pending_review`,
`merge_instructions`, `stack_rebase_status`, `user_diff_view_settings`; `catch_up` → 422.
- `status_checks` (no params; VERIFIED signed in on 2026-10-12 from the React Query cache of GitHub's own PR page):
  `{ aliveChannels: { commitHeadShaChannel }, statusChecks: [{ displayName, state, isRequired, targetUrl, description,
  additionalContext, stateChangedAt, durationInSeconds, avatarUrl, avatarBackgroundColor, copilotCheckRunFailureContext }],
  statusRollup: { combinedState, summary[], pendingWorkflowApprovalRollup } }`. GitHub's own request for it is
  `verifiedFetchJSON`: `Accept: application/json`, `Content-Type: application/json` (on the GET), `GitHub-Is-React: true`,
  `GitHub-Verified-Fetch: true`, `X-Requested-With: XMLHttpRequest`, `X-Fetch-Nonce: <meta fetch-nonce>`,
  `X-GitHub-Client-Version: <meta release>`; the page fetches it once the merge box mounts, cached by head SHA.
- `merge_box?merge_method=SQUASH&bypass_requirements=false` (VERIFIED signed in 2026-10-12, same source): `{ pullRequest: {
  id, state, isDraft, isInMergeQueue, isCrossRepo, mergeStateStatus, autoMergeRequest, headRefName, headRefOid,
  baseRefName, latestOpinionatedReviews, pendingReviewRequests, mergeBoxUserPreferences, mergeQueue, mergeQueueEntry,
  numberOfCommits, viewerCanAddAndRemoveFromMergeQueue, viewerCanAdminBypassMergeRequirements, viewerCanClose,
  viewerCanConvertToDraft, viewerCanDeleteHeadRef, … }, mergeRequirements: { state, conditions, commitMessageHeadline,
  defaultCommitAuthorEmail, … } }`. `merge_method` is the viewer's preferred method, upper case.
  Whether the viewer may turn on auto-merge is `pullRequest.viewerCanEnableAutoMerge` (and `viewerCanDisableAutoMerge`);
  `viewerMergeActions` now lists only `DIRECT_MERGE` and `MERGE_QUEUE`, each with `allowableStatus` `ALLOWED` or
  `BLOCKED` (verified on a BLOCKED pull request whose merge box offered "Enable auto-merge (squash)", 2026-10-13).
  GitHub's merge box enables it with `POST page_data/enable_auto_merge` and body `{ mergeMethod, commitTitle,
  commitMessage, authorEmail? }`, the same fields as a direct merge without `bypassBranchProtections`.
- `diff_entries`: `paths` = each path `encodeURIComponent`-ed, joined with commas (single-encoded also works);
  `ctx` = context-line ranges per path `start-end,…` joined with `:`; `w` = 0|1; `range` = head OID when the
  range starts at the PR base, else `startOid..endOid` within the PR's commits; **without `range` you get the
  full PR diff** (byte-identical to `range=<head>`); `range=<base>..<head>` → HTTP 500.
- Conversation route also loads `/_layout` and `/partials/{body,timeline,sidebar,timeline_actions,links}`;
  commits tab `/pull/{n}/commits` (`X-GitHub-App-Type: dataRouter`) and `/pull/{n}/deferred_commits_data?start_entry=0`;
  the page also sends `POST /{owner}/{repo}/commits/checks-statuses-rollups`.
- `_graphql` is only generic plumbing (`{ query: <persisted id>, variables, persistedQueryName }`); no PR action uses it.

## Markdown preview (the comment box's Preview tab; read from the bundle 2026-10-14, not yet sent)
GitHub's React comment box (`MarkdownEditor`, module `L7`) renders its Preview tab on the server. The request
(function `w` in `tvt-07c6c8edb6d417bf.js`): `POST /preview` (site root, not under the repository) through the bare
`verifiedFetch` (`DI` in module `Qh`): `GitHub-Verified-Fetch: true`, `X-Requested-With: XMLHttpRequest`,
`X-Fetch-Nonce`, `X-GitHub-Client-Version`, no `GitHub-Is-React`, no `Accept`; the body a `FormData` (multipart), fields
in this order:
- `text`: the Markdown; `issue`: the subject's database id; `repository`: the repository's database id; `project`: the
  subject's database id again (GitHub sends both);
- only for a line comment: `path`, `line_number`, `start_commit_oid`, `end_commit_oid`, `base_commit_oid` (= start);
- `subject`: the pull request's number; `start_line_number` (multi-line comments only); `subject_type`: `PullRequest`
  for every comment box on a PR (its surfaces `issue_comment`, `review` and `description` all map there), `Issue` on
  issues, `Project` on projects.

The answer is HTML, used as is (`await response.text()`); on a non-2xx GitHub shows "Markdown preview unavailable". For a PR,
GitHub's subject (module `xoR` in `0m-0ae59ad9dc9eab60.js`) takes the database ids from the PR context: the PR's `id`
(its `relayId` is the node id) and `baseRepository.id`, the same values as the page's embedded
`pullRequestsLayoutRoute.pullRequest.id` and `.repository.id`; CarbonLayer reads those with the header stage. It sends
what GitHub sends for a comment in the conversation (no comparison or line fields), for every comment box, inline ones
too: a ```suggestion block previews as a code block rather than a suggestion.
The same chunk's "Add a suggestion" button (file-diff icon) appends `` ```suggestion\n<lines>\n``` `` after the comment
(a newline before it unless the comment is empty) and puts the caret at the end of the lines; its toolbar's formatting
is `@github/markdown-toolbar-element` (chunk `hj-ece3bec966e8a2b6.js`), its shortcuts are GitHub's command list
(`markdown-editor:*` in `86g-dffecec336e77800.js`: bold ⌘B, italic ⌘I, code ⌘E, link ⌘K, quote ⌘⇧., numbered list ⌘⇧7, task list
⌘⇧L, toggle preview ⌘⇧P) and the docs' "Keyboard shortcuts → Comments" (which also lists ⌘⇧8 for a bulleted list
and ⌘G for a suggestion).

## Reactions (a classic form; seen on the owner's signed-in PR page, 2026-10-14)
GitHub's conversation page reacts with the server-rendered `form.js-pick-reaction` under each comment (in
`.comment-reactions.js-reactions-container`): `POST /{owner}/{repo}/reactions`, form-encoded, fields in this order:
- `_method=put`; `authenticity_token=<86-character token>`; `input[subjectId]=<the subject's node id>`;
- the clicked button's `input[content]`: `"<CONTENT> react"` to add, `"<CONTENT> unreact"` to remove (`THUMBS_UP react`).
  Contents in the picker's order: `THUMBS_UP`, `THUMBS_DOWN`, `LAUGH`, `HOORAY`, `CONFUSED`, `HEART`, `ROCKET`, `EYES`.
- Some forms also carry an empty `input[context]=`; CarbonLayer leaves it out.

Subjects seen: `PR_…` (the PR itself: its description), `IC_…` (conversation comments), `PRR_…` (review summaries).
Diff comments are `PRRC_…`; CarbonLayer sends them through the same form, as GitHub's classic timeline did for review
comments, but no such form was seen on this page: UNVERIFIED. The token is per form action, so one token from any
reaction form on the PR page serves every subject in its repository. The header stage reads
`form.js-pick-reaction input[name="authenticity_token"]` from the PR page it fetches and remembers it with the PR
(`rememberPullRequest`); without one `pr.react` fails with "Reload the pull request to react". It goes out through
`submitForm` (`session.ts`): same origin, `X-Requested-With: XMLHttpRequest`, any 2xx or a redirect elsewhere than sign-in
counting as done; what GitHub answers is not recorded.

Where the current reactions are:
- conversation items (the description, comments, review summaries), in the PR page's HTML: inside the item's form, one
  `button.social-reaction-summary-item.js-reaction-group-button` per reaction given, valued `"<CONTENT> react"`, or
  `"<CONTENT> unreact"` (and `aria-pressed="true"`) when the viewer gave it, reading its emoji
  (`<g-emoji alias="+1">👍</g-emoji>`) and count (`👍 1`). The form's `input[subjectId]` names the subject; a review's own
  form is the one outside the `turbo-frame`s of the threads it opened.
- diff comments, in `page_data/threads`: each comment's `id` (`PRRC_…`) and `reactionGroups: [{ reaction: { content,
  viewerHasReacted }, reactors: [...], totalCount }]`, all eight contents listed, zero counts included.

## Where to re-check (all at https://github.githubassets.com/assets/<file>)
| File | Matched string(s) |
|---|---|
| `4t-c2bbc4f2c8ef0b83.js` | `resolveThread:"resolve_thread"` (full route enum) |
| `ii-669a199209c0df60.js` | `uT.submitReview` / `body:{body:t,event:n,headSha:i}`; `abandonReview`; `` `${e}/file_review` ``; `submitPullRequestTimelineComment`; `baseComparisonInfo` |
| `2q-d4efe397e01acfb1.js` | `createReviewComment`; `lineRequestData(e)`; `multilineRequestData`; `resolution_reason:n`; `unresolveThread` |
| `w6-0a51a23c74142f8b.js` | `uT.merge`; `bypassBranchProtections`; `enableAutoMerge`; `enqueueStack`; `mergeRequestStatus`; `convertToDraft`; `markReadyForReview`; `expectedHeadOid` |
| `vs-a6c1f1d1c661ee6b.js` | `d.append("range",n.headOid)` (diffEntries); `pendingWorkflowApprovalRollup` |
| `dkz-d9892ae5beeced6a.js` | `` `${e}/page_data/${t}` `` |
| `app-runtime-5a19c169236f44a1.js` | `"GitHub-Verified-Fetch":"true"`; `"GitHub-Is-React":"true"` |
| `fetch-utilities-804a14996977c014.js` | `"X-Requested-With":"XMLHttpRequest"`; `X-Fetch-Nonce`; `meta[name="fetch-nonce"]` |
| `app-foundation-156c6259e31cc551.js` | `"X-GitHub-Client-Version"` with `meta[name="release"]` |
| `m5-5f88247ecf67473e.js` | route configs (`page_data/tab_counts`, `partials/…`) |
| `tvt-07c6c8edb6d417bf.js` | `` (0,v.DI)("/preview",{body:f,method:"POST"}) ``; `"Markdown preview unavailable"`; `"Add a suggestion"` |
| `0m-0ae59ad9dc9eab60.js` | `case"issue_comment":return"pull_request_comment"` (the PR comment box's subject) |
| `app-runtime-e674540d54849b57.js` | `"Can not make cross-origin requests from verifiedFetch"` (`DI`, module `Qh`) |
| `hj-ece3bec966e8a2b6.js` | `"header-3":{prefix:"### "}` (markdown-toolbar-element's styles) |

Limits: no POST/PUT/DELETE was sent; bodies come from the code; the signed-out page loads 248 of 1,537
chunks, but every action above is in those.
