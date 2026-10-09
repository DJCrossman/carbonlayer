# Reviewers, assignees, labels and re-runs on GitHub's React PR page (2026-10-09, signed out, GETs only)

`P` = `/{owner}/{repo}/pull/{n}/page_data`. Mutations are JSON POSTs with the headers in github-web-mutations.md.
Responses are proto3 JSON: empty fields are omitted, int64 ids are strings. The React overview preloads
`P/review_requests`, `assignees`, `labels`, `participants`, `development`, `deployments`. Signed out, `/pull/{n}`
serves the classic page.

## Reviewers
**Read `GET P/review_requests`** (VERIFIED on cli/cli#14320, #14355, #14575, #14580):
`{ pendingReviewRequests: [{ reviewer, isCodeOwner?, isCodeOwnerFromDelegation?, deferredType?, delegatedFromTeam?,
createdAt?, requestedCopilotReviewEffort? }], completedReviews?: [{ id, reviewer, state, headSha, submittedAt,
hasWriteAccess, canReRequest, onBehalfOfTeams[], dismissedReviewState }], copilotReviewer?, copilotReviewerRow? }`.
`Reviewer` = `{ id: "47394200", displayLogin, name, avatarUrl, reviewerType: "User"|"Team", organizationLogin?, slug? }`
(teams: `displayLogin: "org/team"`, `organizationLogin`, team `id`, avatar `/t/<id>`; `slug` only on bots).
`deferredType` ∈ DEFERRED_TYPE_CODEOWNER | DEFERRED_TYPE_COPILOT. `state` ∈ REVIEW_STATE_APPROVED | _COMMENTED |
_CHANGES_REQUESTED | _DISMISSED | _PENDING. `completedReviews` is missing signed out (INFERRED: needs a session).
Re-request permission is per review: `completedReviews[].canReRequest`.

**Candidates** (shape INFERRED from the proto; signed out returns `{}`): `GET P/reviewers` on open, then
`GET P/reviewers?q=<encodeURIComponent(text)>` (200 ms debounce) → `{ availableReviewers: [Reviewer] }`;
`GET P/suggested_reviewers` → `{ suggestedReviewers: [{ reviewer, description }] }`. Already-requested = pending
entries without `deferredType`.

**Save `POST P/modify_reviewers`** (delta, sent once when the picker closes):
`{ addReviewers: [{ reviewerId: Number(Reviewer.id), isTeam: bool }], removeReviewers: [same] }` — numeric ids only.
**Re-request `POST P/re_request_review_from_user`** `{ reviewerId: <number> }` (sidebar) or `{ reviewerLogin }`
(timeline menu); only for completed reviews with `canReRequest`. **Remove** = `modify_reviewers` with `removeReviewers`.
Dismiss a review: `POST P/dismiss_review` `{ reviewId, message }`.

## Assignees and labels (same delta pattern)
`GET P/assignees` → `{ assignees: [{ id, displayLogin, avatarUrl, slug?, nodeId }], suggestedAssignees? }`;
`POST P/modify_assignees` `{ addAssignees: [userNodeId], removeAssignees: [userNodeId] }`.
`GET P/labels` → `{ labels: [{ id, name, color, description?, nodeId: "LA_…" }] }` (VERIFIED);
`POST P/modify_labels` `{ addLabels: [labelNodeId], removeLabels: [labelNodeId] }`.
Candidate lists: `/_ghui/item-pickers/assignees?owner&repo&queryId=…&number&query&first` and
`/_ghui/item-pickers/labels?owner&repo&queryId=…&query&count` (GraphQL-shaped JSON; `queryId` hashes change with deploys).

## Re-running checks
- The React PR page sends no re-run request. Check rows: `displayName, state, stateChangedAt, description, targetUrl,
  isRequired, avatarUrl, additionalContext`; Actions ids come from `targetUrl` = `/{o}/{r}/actions/runs/{runId}/job/{jobId}`.
- Only workflow mutation: `POST P/run_action_required_workflows` (approves fork workflows, no body).
- Checks tab is server-rendered: `GET /pull/{n}/partials/checks_partial` (404 signed out).
- Re-run is a classic form POST (action and fields UNVERIFIED): the run page's "Re-run job" dialogs load from
  `GET /{o}/{r}/actions/runs/{id}/job_rerun_dialogs_partial` (empty shell signed out). With a session, read the
  `<form action>` and its hidden `authenticity_token` from that partial and POST it form-encoded.
- No `<meta name="csrf-token">`; each classic form carries its own `authenticity_token` (per form). `page_data` needs none.
- No per-check re-run for non-Actions checks on the page.

## Where to re-check (`github.githubassets.com/assets/`)
`4t-c2bbc4f2c8ef0b83.js` (`modifyReviewers:"modify_reviewers"`, `reRequestReviewFromUser`, `availableReviewers:"reviewers"`,
`suggestedReviewers`, `modifyAssignees`, `modifyLabels`, `dismissReview`), `ii-94a7c9ac773a34fb.js` (`addReviewers/removeReviewers`,
`q=${encodeURIComponent(l)}`, `reviewerId:Number(Q.id)`), `m5-5f88247ecf67473e.js` (protos, `partials/checks_partial`),
`w6-0a51a23c74142f8b.js` (`reviewerLogin`, `dismiss_review`, targetUrl parser), `ju3-f12999ad43f9dadb.js` (run page "Re-run job").
