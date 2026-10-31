# GitHub React PR page: same-origin requests (from the public JS bundles, 2026-10-09; nothing was sent)

Every PR action is a same-origin JSON `fetch` to `P = /{owner}/{repo}/pull/{n}/page_data/<route>`, except
"viewed" which uses `/{owner}/{repo}/pull/{n}/file_review`, reactions, still a classic form (see Reactions below), and
edits of a conversation comment or a review's summary, form fields to their own addresses (see Editing comments below).
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
   - file: `{ subjectType: "file", path }` and nothing more: no `positioning`, `side`, `line`, `startLine` or `startSide`;
     the OIDs are the PR's base and head, as for a line (read from GitHub's bundle 2026-10-28, nothing sent: module `Nd`'s
     `fileRequestData(){return{...this.#y(),path:this.#g,subjectType:i.Wr.File}}` with
     `#y(){return{comparisonEndOid,comparisonStartOid,text,submitBatch}}` in `1i-da73f88b8a5166ba.js`, and
     `Wr:{Line:"line",Multiline:"multiline",File:"file"}` in `10y-c6fbe13d7c809b39.js`). `pr.addThread` and `pr.review`
     send it for a comment on a whole file. A reply in a file's thread is an ordinary reply, below.
   - reply: `{ text, submitBatch, inReplyTo: <last comment databaseId>, path, comparisonStartOid, comparisonEndOid }`
   `submitBatch: false` = add to the pending review; `true` = post immediately. → `{ thread: { id, … }, comment: { databaseId, … } }`.
   Resolve: `POST P/resolve_thread` `{ threadId, resolution_reason? }`; unresolve: `POST P/unresolve_thread`
   `{ threadId }` (`threadId` is the numeric string `threads[].id`). Edit: `PUT P/update_review_comment` `{ body, commentId }`
   (with its version, see Editing comments).
   Delete: `DELETE P/review_comments/{databaseId}`.
4. **Merge**: `POST P/merge` `{ mergeMethod: "MERGE"|"SQUASH"|"REBASE", commitTitle, commitMessage,
   bypassBranchProtections: bool, authorEmail? }` (no head-SHA guard). Update branch: `POST
   P/update_pull_request_branch` `{ updateMethod, expectedHeadOid }`. Stack rebase: `POST P/stack_rebase`
   `{ expectedHeadOids: { "<number>": "<headOid>" } }`. Auto-merge on: `POST P/enable_auto_merge`
   `{ mergeMethod, commitTitle, commitMessage, authorEmail? }` (merge-queue repos: `{ mergeMethod: "SOLO"|"GROUP" }`);
   off: `POST P/disable_auto_merge`. In a native stack (read from the bundle, chunk `cqs-5eeaa26044996c16.js`,
   2026-10-15) GitHub's confirm (`ConfirmMerge`) turns it on with `POST P/enqueue_stack` instead, body exactly
   `{ authorEmail, commitMessage, commitTitle, mergeAction: "AUTO_MERGE", mergeMethod }` (no `bypassRules`; `authorEmail`
   only beside the commit editor, as for a direct merge; title and message the merge box's proposal unless edited). Its
   handler reads nothing of the answer but `{ error }` on a non-2xx, polls nothing (`merge_request_status` is only for
   `DIRECT_MERGE`) and then reloads the merge box. Where the repository has no stack auto-merge (VERIFIED 2026-10-21 on
   offstreetparking/core#9265, the top of a native stack, #9262 merged and #9263–#9265 open) GitHub refuses that request
   with a non-2xx `{ "error": "Stack auto-merge is not enabled." }`, though the repository has "Allow auto-merge" ticked
   and the merge box says `viewerCanEnableAutoMerge: true` (a PR's own auto-merge). That PR page's feature flags were
   `pull_request_stacks`, `pull_requests_stacks_view_ui`, `pull_request_stacks_navigation_shortcuts` and
   `pull_request_stacks_show_all_entries_statuses`, none for stack auto-merge, and GitHub's own merge box offered only
   "Squash and merge stack (3)" (disabled) with its merge methods, no auto-merge; CarbonLayer then merges the stack when it
   is ready itself (ARCHITECTURE.md). Only `enable_auto_merge` remains for a PR alone. Off is
   `disable_auto_merge`, no body, in a stack too (the stack's section sends it, analytics
   `stacks_direct_merge_section.disable_auto_merge`). Before confirming, a stack's confirm says "Auto-merge will be
   enabled for the following pull requests. This will replace any existing auto-merge selections in the stack." over the
   stack's entries up to this one that are neither merged nor queued; once on, the merge box says "This pull request and N
   other(s) in the stack will automatically merge when they all meet the merge requirements." (N: the other entries
   `isInAutoMergeRange`), as each such entry's "Auto-merge enabled" popover in the stack list does. Routes (module `UTz`):
   `enqueueStack: "enqueue_stack"`, `enableAutoMerge: "enable_auto_merge"`, `disableAutoMerge: "disable_auto_merge"`.
   Leave queue: `POST P/dequeue_pull_request`. Native stacks: `POST
   P/enqueue_stack` with `{ mergeAction: "DIRECT_MERGE", mergeMethod, commitTitle, commitMessage, authorEmail?,
   bypassRules: "true"|"false" }` | `{ mergeAction: "MERGE_QUEUE" }` | `{ mergeAction: "AUTO_MERGE", … }` →
   `{ status, uuid }`; poll `GET P/merge_request_status/{uuid}` (1 s backoff ×1.5, 10 min cap) until
   `merged` | `enqueued` | `failed`. GitHub's "Squash and merge stack [N]" sends `DIRECT_MERGE` from the PR viewed (its
   own page data URL), which merges it and every open PR below it: N counts them, this one included (the stack's entries
   neither above it nor merged or queued), and its stack section says "Merging this pull request will also merge N − 1
   pull requests below it" (read from the bundle, 2026-10-15). Its confirm (`ConfirmMerge`, chunk `cqs-5eeaa26044996c16.js`,
   2026-10-15) shows the "Commit message" / "Extended description" editor (⌘↵ in the description merges) only when
   `mergeMethod !== REBASE && !(mergeMethod === SQUASH && merging more than one)`: for a stack, a merge commit only,
   prefilled with the viewed PR's `merge_box` `commitMessageHeadline` / `commitMessageBody`; a squashed stack reads "This
   will squash your changes and merge them into <base>." It sends `commitTitle` / `commitMessage` either way (untouched
   when not shown) and `authorEmail` only beside the editor. The method menu says, for N > 1 branches: merge "All commits
   from these N branches will be added to the base branch via merge commits.", squash "The commits from these N branches
   will be combined into one commit per branch in the base branch.", rebase "All commits from these N branches will be
   rebased and added to the base branch." `bypassRules: "true"` is sent only with the admin's "Merge without waiting for
   requirements to be met (bypass rules)" box; there is no field for optional checks or for rebasing first (rebasing a
   stack is its own `stack_rebase`).
   **Rebase stack** (read from the bundle, chunk `cqs-5eeaa26044996c16.js`, module `p0l`, 2026-10-15; not yet sent):
   `POST P/stack_rebase` `{ expectedHeadOids }`, built from the merge box's STACK condition entries (below) as
   `{ [String(entry.pull.number)]: entry.pull.headOid }` for every entry whose `pull.state` is not `MERGED` (drafts and
   the PRs above included). Its answer is read only for `{ error }` on a non-2xx. GitHub then asks `GET
   P/stack_rebase_status` at once and again after 1 s, ×1.5 each time (10 min cap, "Stack rebase polling timed out")
   until `jobState === "DONE"`; the answer is `{ jobState, pullRequestStates: [{ number, state, message }] }`, `state`
   `PENDING` (Rebasing), `SUCCEEDED` (Rebased), `CONFLICTED` (Merge conflicts) or `FAILED` (Rebase failed), and it
   reloads the merge box a second later. What it says once done: the first CONFLICTED PR, "Rebasing was stopped due to
   merge conflicts" / "Resolve the merge conflicts in pull request #N, then try to rebase this stack again."; else the
   first FAILED, "Rebasing was stopped due to an error" / "Check pull request #N for any issues, then try to rebase this
   stack again."; else "Rebasing complete" / "This stack is up to date and has a linear commit history." While going,
   "Rebasing stack…" / "N of M branches rebased"; a request that failed, "Rebasing was stopped due to a network error" /
   "Try to rebase this stack again. If the problem persists, refresh the page." The button, "Rebase stack", opens a
   confirm of the same name: "Each branch is rebased onto the tip of the one below it, starting from the first unmerged
   branch.", "Once a branch is rebased, it is force-pushed.", "The process stops at the first merge conflict or failed
   rebase." It shows only when `canRebase`: the PULL_REQUEST_USER_STATE condition PASSED (`canUserPushToBase`), the
   first FAILED PULL_REQUEST_RULES condition without a FAILED `ruleRollups` entry of `ruleType` AUTHORIZATION
   (`isUserBlockedFromPushing`), and the PR open and not in the merge queue. Routes (module `UTz`): `stackRebase:
   "stack_rebase"`, `stackRebaseStatus: "stack_rebase_status"`.
5. **Viewed**: `POST /{owner}/{repo}/pull/{n}/file_review` `{ path, viewed: "viewed" }`; unviewed: `DELETE`
   same URL `{ path, _method: "delete" }`. Current state: `base_comparison_info` → `diffSummaries[].markedAsViewed`.
6. **Draft**: `POST P/convert_to_draft` (no body); ready: `POST P/mark_ready_for_review` (optional body).
7. **Close**: `POST /{owner}/{repo}/pull/{n}/page_data/close_pull_request`, no body, through GitHub's verified fetch
   (read 2026-10-22 from the React bundle `yc-b1797c01c5652a4b.js`, where GitHub's Copilot task "archive and close"
   dialog closes a PR with it as mutation `["closePullRequest", repoNwo, number]`, failing on a non-2xx with "Failed to
   close pull request"; not yet sent). No React reopen route was found in the PR page's scripts (item 8's route map names one). The classic
   conversation page closes through its new-comment form, `POST /{owner}/{repo}/pull/{n}/comment?sticky=true`, whose
   "Close pull request" button is `comment_and_close=1`, beside the form's token, `timestamp`, `timestamp_secret`, an
   empty `required_field_<hex>`, `issue` and `comment[body]` (seen on an open PR's page signed in, 2026-10-22); its
   reopen button on a closed PR is unseen.
8. **Head branch** (GitHub's React route map, `uT` in `02j-f0dd7e9816aa464b.js`, 2026-10-22; none sent yet):
   `closePullRequest: "close_pull_request"`, `reopenPullRequest: "reopen_pull_request"`,
   `deleteHeadRef: "delete_head_ref"`, `restoreHeadRef: "restore_head_ref"`. The merge box's "Delete branch"
   (`DeleteClosedHeadBranch` / `DeleteMergedHeadBranch`) and "Restore branch" send
   `POST P/delete_head_ref` / `POST P/restore_head_ref` with `{ method: "POST", headers: { Accept: "application/json" } }`
   through its verified fetch, no body. `merge_box`'s `pullRequest` says who may (VERIFIED with read-only GETs signed in,
   2026-10-22): `viewerCanClose`, `viewerCanDeleteHeadRef` (true on a closed PR whose branch exists, and on an open one),
   `viewerCanRestoreHeadRef` (true on a closed PR whose branch was deleted), `headRepository { ownerLogin, name, url }`.
   The classic page's "Restore branch" is a form, `POST /{owner}/{repo}/pull/{n}/undo_cleanup` with its token.
   CarbonLayer's Close deletes the branch after closing when `viewerCanDeleteHeadRef` and no open PR is based on it
   (`is:pr is:open base:<head>`): deleting a branch an open PR is based on would close that PR too.
   CarbonLayer's Reopen (the closed status card's "Reopen PR", the ⋯ menu's "Reopen pull request") sends
   `POST P/reopen_pull_request`, no body, after `POST P/restore_head_ref` when `viewerCanRestoreHeadRef` says the branch
   is gone (GitHub does not reopen a PR without its head branch): by the route map's names and by analogy with the close
   above, unverified live as of 2026-10-31.

## GET endpoints
Returned 200 signed out (curl), keys confirmed:
- `tab_counts`, `diffstat` (see github-web-endpoints.md).
- `threads[?after=cursor]`: `{ threads: [{ id, subjectType, isResolved, resolvedBy, resolutionReason,
  viewerCanReply, commentsData: { comments: [{ databaseId, id, body, bodyHTML, bodyVersion, reviewId, state, … }] },
  pullRequestReviewId }], aliveChannel }`. **Positions are not here**; they are in
  `base_comparison_info.markers.threads`. `subjectType` is `"LINE"`, or `"FILE"` for a comment on a whole file, which
  has no path and no positioning here; `base_comparison_info`'s `diffSummaries[i].markersMap` lists it under the literal
  key `"FILE"` of its file, with no `start` (`"markersMap":{"FILE":{"threads":[{"id":2967545223}],"annotations":[]}}`;
  public PRs, 2026-10-28). One whose file left the diff is in no `markersMap`; the conversation page still names its
  path (`a.text-mono`) without a `table.diff-table`.
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
  commitMessage, authorEmail? }`, the same fields as a direct merge without `bypassBranchProtections`; for a PR in a
  native stack, with `enqueue_stack` `AUTO_MERGE` (Mutations, 4).
  In a native stack (seen on offstreetparking/core#8986 and #8985 signed in, 2026-10-15): `pullRequest.anyStackBranchOutdated`
  and `pullRequest.stackedBaseRefName` (the stack's base), and a STACK condition `{ type: "STACK", displayName,
  description, message, result, stack, isStacked, entries }`, each entry `{ position: "BEFORE"|"CURRENT"|"AFTER",
  status, … }` (`NEEDS_MERGE_STATE`, `IRRELEVANT_DRAFT`, `IRRELEVANT_MERGED`, `IRRELEVANT_AFTER`, `IRRELEVANT_QUEUED`,
  `MERGE_CONFLICTS`, `NEEDS_REBASE`, `BLOCKED_STACK`). GitHub's bundle reads each entry's PR as `entry.pull` (`number`,
  `headOid`, `state`, `url`, `isInAutoMergeRange`); (VERIFIED live 2026-10-19 on #8986: entries are `{ pull, position, failedSubConditions, status }`). GitHub's merge box
  (module `MDN`) shows one section about the stack's branches, the first that applies: the CURRENT entry
  `MERGE_CONFLICTS`, "This branch has conflicts that must be resolved"; any entry but AFTER ones `MERGE_CONFLICTS`, "This
  stack has conflicts that must be resolved" (both "Use the command line to resolve conflicts within the stack before
  continuing.", with "Resolve conflicts"); any entry but AFTER ones `NEEDS_REBASE`, "Some branches in this stack have
  diverged and must be rebased" / "Rebase this stack to restore a linear commit history across its branches.";
  `anyStackBranchOutdated`, "This stack is out-of-date with its base branch" / "Rebase this stack onto the latest
  version of <stackedBaseRefName>." The last two carry "Rebase stack". An entry up to this PR in conflicts or needing a
  rebase also makes the merge and auto-merge buttons inactive, "Merging is blocked due to failing stack merge
  requirements" (`isMergeCurrentlyBlocked`, which other not-ready entries set too); an out-of-date stack does not.
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

## Slash commands (the comment box's `/` list; read from the bundle 2026-10-27, nothing sent)
**Where GitHub offers them.** The React `CommentBox` (`42g-ca4daad95973f750.js`) wraps its editor in
`SlashCommandsProvider` only when its subject's `repository.slashCommandsEnabled` is true; on a PR that is the route's
`baseRepository.slashCommandsEnabled` (`10y-5e576a8f14f8ec33.js`), and every box on the page passes a subject (module `fYM`
in `1i-6d5de88b35e79530.js`: surface `review` → type `pull_request`, `issue_comment` → `pull_request_comment`,
`description` → `pull_request_body`; diff comments and replies are `review`). The provider renders GitHub's classic
`<slash-command-expander keys="/" data-slash-command-url="/{owner}/{repo}/slash_apps?surface=<type>&subject_gid=<PR node
id>">` around the textarea, and adds a last toolbar button, "Slash commands" (`DiffIgnoredIcon`), that only types `/` at
the caret. Signed out, the page's `slashCommandsEnabled` is false and `slash_apps` answers 404.

**When the list opens** (`findMatch`, module `N15` in `chunk-lazy-element-slash-command-expander-fb44fde27f4a8d71.js`):
the last `/` before the caret (`selectionEnd`), when nothing or a `\n` comes before it and no space or `\n` after it. So a
`/` at the start of the text or of a line, followed by no space, line break or other `/`; not `a/b`, a URL, `see /code`
or an indented `/`. It waits 250 ms after typing (`appropriateDelay`) and ignores the input of a paste.

**The list** (`onChange`, module `JBZ` in `chunk-fq-43d52ee315d5dd1e.js`): a loading clone first, then `GET` of
`data-slash-command-url` (once per page, memoized) as an HTML fragment (`fetchSafeDocumentFragment`: the `X-HTML-Safe`
nonce is checked); its rows are `.js-slash-command-menu-items li[data-text]`, grouped after `.js-group-divider[data-group-id]`.
With nothing typed, the server's order; else what was typed, lowercased and trimmed, keeps the rows whose `data-text`
scores above 0 on GitHub's fuzzy score (`dt` in module `Pk`: each character found after the one before, 0.2 each, 0.8 more
when consecutive or first and when after a space, `-` or `_`, averaged and weighed by the share of the text, +0.1 when the
first character starts the text, 1 for the whole text; plus the same score of the part after the last `/`), best first,
then by text (`UD`), back under their dividers. No row left closes it. Keys are `@github/combobox-nav` with
`tabInsertsSuggestions: false`: Enter or a click chooses, Tab does not; the first row is reached at once; ↓ past the last
(or ↑ before the first) reaches none rather than wrapping; Ctrl+N / Ctrl+P on a Mac; Esc closes it (`deactivate`).

**Choosing** (`onValue`) PATCHes the row's `data-url` with its `.js-slash-command-suggestion-form` (`Accept: text/html`,
`Scoped-CSRF-Token` from its `.js-data-url-csrf`). The answer's first element says what follows by `data-component-type`:
`fill` puts its text (its HTML when it holds tags) in place of the `/` and what was typed, through `insertText`, with a
space after it and the caret at its `%cursor%` mark, else after the space (a mark at index 0 counts as none);
`data-submit-form` then submits the comment. `menu` / `error` show a new list in place of the old, the typed text kept
(typing again goes back to the commands); `action` closes it; `embedded_form`, `dialog_form` and `modal_form` show a form
whose submit PATCHes its `action` and is answered the same way.

**What the server answers** is not in the bundle. Read from GitHub's own recording of the feature (the video in the
changelog "Introducing the GitHub Markdown Helpers Public Beta", 2023-03-15) and a recent screenshot of the list on an
issue: the header (code-square icon, "Slash commands", then "Beta" and "Give feedback" in 2023, "Preview" now), the group
"Markdown", each row a bold name over a description, alphabetical: Alerts "Add a markdown alert to emphasize important
information" (not in 2023), Code block "Insert a code block formatted for a chosen syntax", Details "Add a details tag to
hide content behind a visible heading", Saved replies "Insert one of your saved replies", Table "Add markdown table",
Templates "Insert one of your issue templates" (and, on an issue in 2023, Tasklist "Add a Tasklist block"). `data-text` is
the name: on screen `/d` lists Details, Code block, Saved replies and `/s` Saved replies, Details, Tasklist, Templates, as
the score orders the names.
- Code block: a list headed "Slash / Code block": No Syntax, then Linguist's popular languages (`lib/linguist/popular.yml`,
  C … TypeScript, 25); Java fills `` ```java\n%cursor%\n``` ``.
- Details: fills at once `<details><summary>Details</summary>\n<p>\n\n%cursor%\n\n</p>\n</details>` (the docs' "you
  choose the title and content" is not what the recording shows).
- Table: "Slash / Table / Columns" (1 column … 5 columns), then "Slash / Table / Columns / Rows" (1 row … 5 rows); 3 × 3
  fills `| Header | Header | Header |`, `|--------|--------|--------|` and three `| Cell | Cell | Cell |`, no mark.
- Saved replies: "Slash / Saved replies", each reply's title over its body cut short; fills the body.
- Alerts: only its row, and `> [!WARNING]` / `> Some alert message` in the box above the list, are seen.

**What CarbonLayer does** (`SLASH_COMMANDS`, `slashCommandQueryAt`, `slashCommandsFor`, `insertAlert`, `insertCodeBlock`,
`insertDetails`, `insertTable`, `savedReplyChoices` in `src/pr/markdown-editing.ts`; the list in
`CommentInput`): Alerts, Code block, Details, Saved replies and Table in every comment box, whatever
`slashCommandsEnabled` says, with the Markdown above built in rather than asked for (Saved replies' rows are the viewer's
replies, below), the same trigger and score (without the second score of the part after a
`/`, which only doubles these names'), and the space and `%cursor%` caret of `fill`. Its keys are its other lists' (Tab
chooses, ↑ / ↓ wrap), it opens at once and after a paste too, and it has no "Preview" label, feedback link or toolbar
button. INFERRED: Alerts' second step (GitHub's five kinds, in the docs' order) and "Some alert message" as GitHub's text
rather than the user's; every language's fence but `java` (Linguist's default alias, the name in lower case: `c#`,
`objective-c`); No Syntax as a bare fence; whether Templates is offered on a PR comment.

**Saved replies.** The editor's own toolbar menu (⌘. / Ctrl+., the `SavedRepliesButton` in `42g`)
loads the list with `GET /settings/replies?context=pull_request` (function `$`; `context` is the subject's type mapped to
`issue` or `pull_request`, and all three PR types map to `pull_request`), once per box with its mentions and references, on
its first focus. It goes through `verifiedFetchJSON` (`lS` in module `VY`, `app-runtime-1a555c9bb4a1f269.js`): `Accept:
application/json`, `Content-Type: application/json`, `GitHub-Verified-Fetch: true` and the usual `X-Requested-With`,
`X-Fetch-Nonce`, `X-GitHub-Client-Version`, no `GitHub-Is-React`. The answer is a JSON array whose `title` and `body` are
read (`{ name: title, content: body }`); any failure means no replies. The menu filters by name (contains, case aside;
"Search saved replies"), shows the body under each name, picks the first nine with Ctrl+1…9 and links "Create new" to
`/settings/replies`; choosing one puts its body over the selection, in the next frame, through Primer's
`useSyntheticChange` (`insertText`, the caret after it), with no `%cursor%` handling. The `/saved-replies` command goes
through `slash_apps` instead (a `menu` of the replies, then a `fill` of the body: `%cursor%` honoured, a space after).
Signed out (curl, 2026-10-27), the GET with those headers answers 404 `{"error":"Couldn’t authenticate you"}` (without
them, a redirect to `/login`). CarbonLayer (since 2026-10-27) sends that GET with those headers (`markdown.savedReplies`
in `src/lib/github-web/index.ts`, `request(…, { react: false })`) the first time a box opens Saved replies' step, keeps
the answer five minutes for every box (and in the page's memory only, never on the device), reads each reply's `title`
and `body` (another shape is refused) and lists them as the slash command's step: the title over the body, cut to a line,
choosing one putting the body in as `fill` does. With none, or when the load fails, the step says "You don't have any
saved replies yet." (CarbonLayer's words: GitHub's empty state is server-rendered and unseen); under the step, "Create
new" (the toolbar menu's label) opens `https://github.com/settings/replies` in a new tab. No toolbar menu. UNVERIFIED: the
JSON's other fields and its order, and an answer to CarbonLayer's request signed in.

| File | Matched string(s) |
|---|---|
| `42g-ca4daad95973f750.js` | `SlashCommandsProvider`; `` `/${w.repository.nwo}/slash_apps?surface=` ``; `"Slash commands"` (toolbar button); `` `/settings/replies${e?`?context=${e}`:""}` ``; `SavedRepliesButton` |
| `1i-6d5de88b35e79530.js` | `case"issue_comment":return"pull_request_comment"`; `slashCommandsEnabled:h` |
| `chunk-lazy-element-slash-command-expander-fb44fde27f4a8d71.js` | `slash-command-expander`; `appropriateDelay(){return 250}`; `%cursor%` |
| `chunk-fq-43d52ee315d5dd1e.js` | `js-slash-command-menu-items li`; `data-component-type`; `"Scoped-CSRF-Token"` |

A lazy chunk's file is `chunk-<name>-<hash>.js`, both from the maps in the runtime's `n.u` (`wp-runtime-324664e7bd39619e.js`;
`0vz` is the expander, `fq` its provider).

## Reactions
**What CarbonLayer sends (since 2026-10-22).** A diff comment (`PRRC_…`) as GitHub's files view reacts to one:
`POST P/add_comment_reaction` or `POST P/remove_comment_reaction`, JSON `{ reaction: "THUMBS_UP", commentId: <the review
comment's database id, a number> }` (`10y-80d81b4460babeb2.js`, its `commentDatabaseId`); the content script finds the
database id by the node id among the threads it has loaded. GitHub's conversation page uses the same two routes with
`{ reaction, issueCommentId }` for a conversation comment and `{ reaction, reviewSummaryCommentId }` for a review
(`s9-a66348c89404f31d.js`; which id each takes is not confirmed); no variant for the description was seen.
Everything else goes the way GitHub's React reaction viewer reacts to anything reactable by its node id, through
`/reactable_item/reactions` (module `UK8` in `imj-726732cadc7a4f06.js`, read 2026-10-22): `POST` adds, `DELETE` removes, a
JSON body `{ subjectId, content }` (`content` as `THUMBS_UP`, …), sent through its `verifiedFetchJSON` with
`GitHub-Is-React` (`Sr` in `app-runtime`: `Accept` and `Content-Type: application/json`, `GitHub-Verified-Fetch`, and
its usual `X-Requested-With` / nonce headers). It answers in GraphQL's shape, `{ data: { addReaction | removeReaction:
{ subject } } }`, or without `data` and with `errors: [{ message }]` when it would not. Not yet seen answering CarbonLayer.

**The classic form, no longer used.** Sent from the app for a diff comment (`PRRC_…`) on 2026-10-22, it was refused:
`GitHub answered 406 to POST /offstreetparking/core/reactions`. What follows is how GitHub's classic page reacts (seen on
the owner's signed-in PR page, 2026-10-14).
GitHub's conversation page reacts with the server-rendered `form.js-pick-reaction` under each comment (in
`.comment-reactions.js-reactions-container`): `POST /{owner}/{repo}/reactions`, form-encoded, fields in this order:
- `_method=put`; `authenticity_token=<86-character token>`; `input[subjectId]=<the subject's node id>`;
- the clicked button's `input[content]`: `"<CONTENT> react"` to add, `"<CONTENT> unreact"` to remove (`THUMBS_UP react`).
  Contents in the picker's order: `THUMBS_UP`, `THUMBS_DOWN`, `LAUGH`, `HOORAY`, `CONFUSED`, `HEART`, `ROCKET`, `EYES`.
- Some forms also carry an empty `input[context]=`; CarbonLayer leaves it out.

Subjects seen: `PR_…` (the PR itself: its description), `IC_…` (conversation comments), `PRR_…` (review summaries).
Diff comments are `PRRC_…`; no classic form for them was seen on this page. The form's token is per form action, so one
token from any reaction form on the PR page served every subject in its repository.

Where the current reactions are:
- conversation items (the description, comments, review summaries), in the PR page's HTML: inside the item's form, one
  `button.social-reaction-summary-item.js-reaction-group-button` per reaction given, valued `"<CONTENT> react"`, or
  `"<CONTENT> unreact"` (and `aria-pressed="true"`) when the viewer gave it, reading its emoji
  (`<g-emoji alias="+1">👍</g-emoji>`) and count (`👍 1`). The form's `input[subjectId]` names the subject; a review's own
  form is the one outside the `turbo-frame`s of the threads it opened.
- diff comments, in `page_data/threads`: each comment's `id` (`PRRC_…`) and `reactionGroups: [{ reaction: { content,
  viewerHasReacted }, reactors: [...], totalCount }]`, all eight contents listed, zero counts included.

## Editing comments (read from GitHub's bundles and public PR pages signed out, 2026-10-27; nothing sent)
**What CarbonLayer sends** is what GitHub's React PR UI sends for each surface: its files view for a diff comment, and
its "Overview" (`OverviewTimelinePanel`, chunk `z0-aef251b5fbae1bb5.js`; the page_data/header `featureStates.overview` was
`UNAVAILABLE` on public PRs signed out) for the description, a conversation comment and a review's summary. Its route map
(`uT` in `7d-9de51296df3af678.js`) has `updateDescription: "update_description"` and `updateReviewComment:
"update_review_comment"` (beside `updateTitle`, `hideComment`, `unhideComment`, `description`, `conversationComments`), and
no route for an issue comment or a review: those go to their Rails addresses. All through GitHub's verified fetch
(module `VY` in app-runtime: `DI` adds `GitHub-Verified-Fetch` and `kt()`'s `X-Requested-With`, `X-Fetch-Nonce`,
`X-GitHub-Client-Version`; `QJ` adds `GitHub-Is-React`; `Sr`, used through `q$` of module `qIa`, also `Accept` and
`Content-Type: application/json` and a JSON body). No `authenticity_token`.
- **Description**: `PATCH P/update_description`, JSON `{ body }` (through `q$`). The answer is read as the description's
  data, `page_data/description`'s shape. Failure: "Failed to update description"; success: "Pull request description updated
  successfully." GitHub offers "Edit description" when `layoutCurrentUser.canEditTitle` (selector `eL` in module `jg`,
  `10y-5e576a8f14f8ec33.js`), the header stage's `viewerCanUpdate`.
- **Conversation comment**: `PUT /{owner}/{repo}/issue_comments/{databaseId}`, a `FormData` body `issue_comment[body]`,
  `body_version` (the comment's `bodyVersion` when the edit started), `Accept: application/json`, through `QJ` (function `lz`).
  Answer `{ source, body (HTML), newBodyVersion, lastUserContentEdit }`.
- **Review summary**: `PUT /{owner}/{repo}/pull/{n}/reviews/{databaseId}/update`, `FormData` `pull_request_review[body]`,
  `body_version`, the same way (function `oC`).
- **Diff comment**: `PUT P/update_review_comment?body_version=<bodyVersion>` (no query without a version), JSON `{ body,
  commentId: String(databaseId) }`, through `q$` (`1i-6d5de88b35e79530.js`). Answer `{ threadId, commentDatabaseId, body,
  bodyHTML, bodyVersion, lastUserContentEdit }`; failure "Failed to update comment".
- **Refusals** (module `qIa`, `md-6857b71962c0d6d9.js`): a non-2xx answer with `stale: true` (and `updated_markdown`,
  `updated_html`, `version`) is an edit made over a newer one, "The content you are editing has changed. Please review the
  latest changes and try again." (checked first for the two form edits); else GitHub's `{ error }`, or "Unknown error
  occurred"; a 5xx "The server is currently unable to perform this operation. Please try again later." Edit shows only where
  the comment's `viewerCanUpdate`.

**The classic conversation page** edits the same addresses with its own forms: `form.js-comment-update`, `_method=put` and a
token of its own, actions `/{owner}/{repo}/issues/{n}` (the description), `/{owner}/{repo}/issue_comments/{id}` and
`/{owner}/{repo}/pull/{n}/reviews/{id}/update` (seen on public PRs). Its other fields load when Edit is clicked
(`include-fragment.js-comment-edit-form-deferred-include-fragment`, `src="…/edit_form?textarea_id=…&comment_context="`; 404
signed out). GitHub's remote-form posts it multipart with `Accept: application/json` and `X-Body-Version` from the
`.js-comment`'s `data-body-version` when it has one (`yga-dd50cf95593467fe.js`), and reads `{ body, source, newBodyVersion,
errors }`: a 422 with `errors` says "There was an error posting your comment: …", one with `stale` marks the comment stale.
CarbonLayer sends the React requests instead, which need no form token.

**Who may edit what, and from what Markdown** (public pages signed out; nodejs/node#62105, react/react#31000):
- The conversation page (the content sits inside `turbo-frame#repo-content-turbo-frame`) renders each comment's, each review
  summary's and the description's options menu inline (`.timeline-comment-actions details-menu`, `src=""`), holding "Copy
  link" and "Copy Markdown": `<clipboard-copy role="menuitem" value="<the Markdown as GitHub keeps it>">`. A code block's own
  copy button is a `clipboard-copy[value]` without the role. The value keeps GitHub's raw CRs (a body written in the web UI
  ends its lines with CRLF), which an HTML parser turns into LF: the Markdown read may differ from GitHub's in line ends.
  GitHub's classic JS handles `.js-comment-edit-button`, the menu's Edit; a signed-out page has none. CarbonLayer offers Edit
  where that button is in the comment's own menu (a review's: outside its threads' `turbo-frame`s). UNVERIFIED signed in:
  that the menu holds Edit exactly where the viewer may edit the comment, and nothing more.
- A conversation comment's `.timeline-comment.js-comment` carries `data-body-version`, 64 hex digits: the SHA-256 of its
  Markdown as GitHub keeps it (checked on 8 comments; `bodyVersion` against `body` likewise for 98 diff comments and 5
  conversation_comments items). A review's `.js-comment` and the description carried none, so CarbonLayer sends a review's
  edit without a version, as GitHub's classic page sends no `X-Body-Version` for it.
- `page_data/description`: `{ body, bodyHtml, bodyVersion, editInformation: { lastUserContentEdit,
  viewerCanReadUserContentEdits }, reactionGroups, viewerCanReact }`, no can-edit flag. CarbonLayer reads the description's
  Markdown from its menu's Copy Markdown, or this `body` where the conversation renders no description.
- `page_data/threads` comments carry `body`, `bodyHTML`, `bodyVersion`, `databaseId`, `viewerCanUpdate`, `viewerCanDelete`,
  `viewerCanMinimize`, … (keys confirmed).
- `page_data/conversation_comments` (what the Overview reads; 40 a page, `Link: <…?after=…>; rel="next"`, `?direction=desc`
  newest first, one item at `…/conversation_comments/{type}/{id}`) lists `issue` and `review_summary` items with `id`
  (database id), `relayId`, `body`, `bodyHTML`, `bodyVersion`, `viewerCanUpdate`, `viewerCanDelete`, …. CarbonLayer does not
  ask for it: the conversation page it already reads has the menus.

UNVERIFIED: none of these writes has been sent; GitHub's answers to them, and whether its Rails addresses take the React
form edits from a viewer without the Overview, are read from the bundle only.

## Deleting comments (read from GitHub's bundles, 2026-10-29; nothing sent)
**What CarbonLayer sends**, as GitHub's React PR UI sends it, through its verified fetch, with no body:
- **Diff comment**: `DELETE P/review_comments/{databaseId}` through `q$` (the files view's delete in `1i-da73f88b8a5166ba.js`:
  ``let r=`${d}/page_data/review_comments/${i.databaseId}`,a=await (0,w.q$)(`${r}`,{method:"DELETE"})``), a 204 or 200 being
  success, anything else read for GitHub's error as an edit's is. GitHub drops a thread left without comments.
- **Conversation comment**: `DELETE /{owner}/{repo}/issue_comments/{databaseId}` with `Accept: application/json`, through
  `QJ` (the Overview's in `le-5d7c26ddb3970d6b.js`, beside its edit of the same address).
- **Review**: neither UI deletes a submitted review; there is no route for it.

**Who may delete what.** `page_data/threads` comments carry `viewerCanDelete`. On the classic conversation page GitHub's
own JS deletes a comment through a remote form, `.js-comment .js-comment-delete` (`yga-dd50cf95593467fe.js`: it sends the
comment's `X-Body-Version` and removes the `.js-comment` once answered), which sits in the comment's menu where the viewer
may delete it; a signed-out page has none. CarbonLayer offers Delete only on the viewer's own comments, by login: a diff
comment with `viewerCanDelete`, a conversation comment whose menu holds `.js-comment-delete`, never another's, though
GitHub lets a repository's admin delete anyone's. UNVERIFIED signed in: the classic menu's delete form, as for its Edit.

## Labels and assignees (classic sidebar forms; read from GitHub's page signed in, 2026-10-22, nothing sent)
GitHub's own PR sidebar (`#partial-discussion-sidebar` on the classic conversation page) sets labels and assignees with
classic Rails forms on the ISSUE path of the PR's number, `I = /{owner}/{repo}/issues/{n}`. Read on one PR's page with
GETs only; no form was submitted.
- **Assignees, the choices**: `GET I/show_partial?partial=issues%2Fsidebar%2Fassignees_menu_content` with `Accept:
  application/json` and `X-Requested-With: XMLHttpRequest` answers 200 `application/json` `{ users: [{ id: <number>,
  login, name, avatar, selected: <boolean>, class }] }` (15 users on that PR). `selected` marks the current assignees.
  GitHub's menu filters the list in place ("substring-memory") and shows at most 30. Asked with `Accept: text/html`, the
  same address answers the menu's HTML shell (a filter input and a `<template>` row), which holds no form or token.
- **Assignees, the save**: the conversation page's sidebar carries `<form class="js-issue-sidebar-form" method="post"
  action="I/assignees">` with `_method=put`, its own `authenticity_token`, `issue[user_assignee_ids][]` for each
  assignee's numeric user id, and one empty hidden `issue[user_assignee_ids][]`, so that sending none clears them.
  GitHub's "assign yourself" is a submit button in that form named `issue[user_assignee_ids][]`, valued with the viewer's
  id.
- **Labels, the choices and the save**: `GET I/show_partial?partial=issues%2Fsidebar%2Flabels_menu_content`
  (`X-Requested-With: XMLHttpRequest`, `Accept: text/html`) answers 200 HTML of about 48 KB holding `<form method="post"
  action="I/labels">` with `_method=put`, `authenticity_token`, one empty hidden `issue[labels][]` and a
  `div.js-filterable-issue-labels` with one row per label of the repository (21 on that one). A row is `<label
  class="select-menu-item label-select-menu-item text-normal js-filterable-label" role="menuitemcheckbox"
  aria-checked="true|false" data-prio-filter-value="<name>">` holding `<input hidden type="checkbox"
  data-label-name="<name>" value="<label id, 10 digits there>" name="issue[labels][]">`, a `div.js-label-color` with
  `label-color="<hex>"`, and `span.name.js-label-name-html` (GitHub's rendering of the name, which may hold emoji HTML).
  No description element was seen in a row. The partial's second form (`action="/{owner}/{repo}/labels"`) creates a
  label.

**In the app** (`src/lib/github-web/issue-sidebar.ts`, writes in `mutations.ts`): `pr.labelCandidates` reads the labels
partial (its form, that form's token and each row: id, name, colour, a `.description` should a row have one, applied when
`aria-checked="true"` or the box is `checked`), `pr.assigneeCandidates` the assignees JSON; each list is kept 60 s per PR,
and any successful write clears it. `pr.modifyLabels { add, remove }` (label ids) reads the partial again and posts its
form through `submitForm`: `_method=put`, that form's token, the empty `issue[labels][]`, then the id of every label on
the PR and not removed, or added, in the menu's order. `pr.modifyAssignees { add, remove }` (logins) reads the
assignees JSON for the ids and who is assigned, then posts to `I/assignees`: `_method=put`, the token of the form the
header stage found posting there on the conversation page it fetches (`rememberPullRequest`'s `assigneesToken`; without
one the write asks for a reload), the empty `issue[user_assignee_ids][]`, then the ids. "assign yourself" is
`pr.modifyAssignees` adding the viewer's login. The page then loads the meta stage again (`page_data/labels`,
`page_data/assignees`); GitHub's answer to the form is not read.
- The menus go through `request()` (`session.ts`), which also sends `GitHub-Verified-Fetch: true`, `GitHub-Is-React:
  true`, `X-Fetch-Nonce`, `X-GitHub-Client-Version` and, for the JSON one, `Content-Type: application/json`, as it does to
  every JSON route and to the classic top-repositories fragment. Only `Accept` with `X-Requested-With` was verified on
  these two; that GitHub answers them alike with the others is UNVERIFIED.
- UNVERIFIED: neither form has been sent; GitHub's reply to either is unseen (presumably the sidebar's HTML); whether a
  described label's row carries a description element, and which; whether the conversation page always renders the
  assignees form inline rather than loading the sidebar later. The React bundle's `page_data/modify_labels` and
  `modify_assignees` (github-web-reviewers.md) are not used.

## Where to re-check (all at https://github.githubassets.com/assets/<file>)
| File | Matched string(s) |
|---|---|
| `4t-c2bbc4f2c8ef0b83.js` | `resolveThread:"resolve_thread"` (full route enum) |
| `ii-669a199209c0df60.js` | `uT.submitReview` / `body:{body:t,event:n,headSha:i}`; `abandonReview`; `` `${e}/file_review` ``; `submitPullRequestTimelineComment`; `baseComparisonInfo` |
| `2q-d4efe397e01acfb1.js` | `createReviewComment`; `lineRequestData(e)`; `multilineRequestData`; `resolution_reason:n`; `unresolveThread` |
| `1i-da73f88b8a5166ba.js` | `fileRequestData(){return{...this.#y(),path:this.#g,subjectType:i.Wr.File}}` (module `Nd`) |
| `10y-c6fbe13d7c809b39.js` | `Wr:{Line:"line",Multiline:"multiline",File:"file"}` |
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
| `cqs-5eeaa26044996c16.js` | `mergeAction:"AUTO_MERGE"` (a stack's auto-merge); `StackRebaseOptional` (the stack's sections, module `MDN`); `expectedHeadOids:n` and `"DONE"===t.jobState` (Rebase stack, module `p0l`) |
| `7d-9de51296df3af678.js` | `updateReviewComment:"update_review_comment"`, `updateDescription:"update_description"` (the route map `uT`) |
| `z0-aef251b5fbae1bb5.js` | `` issue_comments/${t}` `` with `r.set("issue_comment[body]",n)`; `` /reviews/${t}/update` ``; `j.uT.updateDescription` with `method:"PATCH"`; `"Edit description"` |
| `1i-6d5de88b35e79530.js` | `` ?body_version=${n} `` with `method:"PUT",body:{body:i,commentId:t}` |
| `md-6857b71962c0d6d9.js` | `"The content you are editing has changed. Please review the latest changes and try again."` (module `qIa`: `q$`, `hp`, `R`, `C$`) |
| `app-runtime-1a555c9bb4a1f269.js` | `QJ:()=>s` (`GitHub-Is-React` over `verifiedFetch`, module `VY`) |
| `yga-dd50cf95593467fe.js` | `".js-comment .js-comment-update"`, `X-Body-Version` (the classic edit form) |

Limits: no POST/PUT/DELETE was sent; bodies come from the code; the signed-out page loads 248 of 1,537
chunks, but every action above is in those.
