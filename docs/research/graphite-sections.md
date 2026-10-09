# Graphite PR-inbox section filters (from app.graphite.com's public bundles, 2026-10-09)

B1 = `_next/static/chunks/app/(routes)/[[...slug]]/page-d467e02494bc610b.js`, B2 = `_next/static/chunks/72766.db239c7fed623ad6.js`.

## Structure (VERIFIED)
- Share-link / UI form: `{ groups: [{ rules: [{ isNegated: bool, conditions: [Cond, …] }] }] }`.
- Semantics: `OR(groups → AND(rules → isNegated ? NOT(OR(conditions)) : OR(conditions)))`.
- All conditions in one rule share the same `kind` (`isValidFilterRule`).
- Repositories are a section-level field `repos: [{ owner, name, forge? }]`, not a condition. No Repository, Draft or Stack condition exists.

## Condition kinds (VERIFIED from the `SCHEMAS` map; "Inbox" = offered in the inbox picker)
| kind | payload | UI label | Inbox |
|---|---|---|---|
| PR_OPENING_SOURCE_IS | `source`: human\|any_agent\|grok_bot\|automations\|`project:<id>` | Source (is / is not) | gated |
| REVIEW_STATUS_IS | `state` (enum below) | Review status (equals / does not equal) | yes |
| AUTHOR_IS | `username` (literal `"A bot"` = any bot; `org/team` = team) | Author (is / is not) | yes |
| APPROVED_BY | `username` | Approvers (include / do not include) | yes |
| INCLUDES_ASSIGNEE | `username` | Assignees | yes |
| INCLUDES_PAST_REVIEWER | `username` | Previous reviewers (users who left reviews) | yes |
| INCLUDES_DIRECT_REVIEWER | `username` | Direct reviewers (not via a team) | yes |
| INCLUDES_DIRECT_TEAM_REVIEWER | `slug` (`org/team`) | Currently requested team reviewers | yes |
| OPEN_REVIEW_REQUEST_FOR | `username` | Currently requested reviewers (no review yet) | yes |
| CLOSED_REVIEW_REQUEST_FROM | `username` | Active reviewers (reviewed, not re-requested/dismissed) | yes |
| REOPENED_REVIEW_REQUEST_FOR | `username` | Currently re-requested reviewers | yes |
| MENTIONS | `username` | Mentions | yes |
| NUM_FILES_CHANGED | `numFiles` | Number of files changed (greater than / ≤) | yes |
| NUM_LINES_CHANGED | `numLines` | Number of lines changed | yes |
| CONSOLIDATED_PR_STATUS_IS | `status` (enum below) | PR status (is / is not) | yes |
| LAST_UPDATED | `hours`: 24\|72\|168\|672 | Latest activity (less than / greater than) | yes |
| TITLE_CONTAINS | `text` | Title (contains / does not contain) | yes |
| DESCRIPTION_CONTAINS | `text` | Description | yes |
| MERGE_BASE_IS | `mergeBase` | Parent branch (is / is not) | yes |
| HAS_LABEL | `label` | Labels (include / do not include) | yes |
| IS_EXTERNAL_REPOSITORY | none | PR origin (forked only / original only) | yes |
| INCLUDES_REVIEWER | `username` | Reviewers | automations only |
| CI_STATE_IS | `state`: PASSING_ALL\|PASSING_REQUIRED\|FAILING_REQUIRED\|FAILING_NON_REQUIRED\|COMPLETED_ALL | CI status | automations only |
| STATUS_CHECK_PASSING / STATUS_CHECK_FAILING | `name` | Passing / failing checks | automations only |
| FILE_CHANGE_PATH_MATCHES | `glob` | File path | automations, merge rules |
| TRUNK_IS | `trunk` | Trunk branch | merge rules only |

## Enums (VERIFIED values; GitHub mapping INFERRED)
REVIEW_STATUS_IS.state: ONE_OR_MORE_APPROVALS (≈ `review:approved`), IS_FULLY_APPROVED (≈ `review:approved`),
HAS_ACTIVE_REVIEW (no equivalent), HAS_ONE_OR_MORE_REQUESTED_REVIEWERS (no equivalent), HAS_REREQUESTED_REVIEW
(none), HAS_CHANGES_REQUESTED (`review:changes_requested`), HAS_UNADDRESSED_CHANGES_REQUESTED (≈ same),
REVIEW_REQUIRED_GITHUB (`review:required`), APPROVED_GITHUB (`review:approved`). No "none" state.

CONSOLIDATED_PR_STATUS_IS.status: OPEN (`is:open -is:draft`), DRAFT (`is:draft`), MERGING (Graphite merge queue, ≈ `is:open`),
MERGED (`is:merged`), CLOSED (`is:closed is:unmerged`).

## "Me" (VERIFIED)
Saved filters hold the viewer's literal login; `me`/`self`/`myself` are only picker aliases. A link shared with
"replace @login with recipient's handle" carries the literal `<REPLACE_USERNAME>` wherever the value equalled the
sharer's login (all username kinds; not team slugs). An importer maps `<REPLACE_USERNAME>` → `@me`.

## Link encodings (VERIFIED, B2)
- One section: `?new-section=` + `btoa(encodeURIComponent(JSON.stringify(filter)))` (standard base64, then form-encoded).
  Decode: `JSON.parse(decodeURIComponent(atob(value)))`; max 100,000 chars. Payload is only `{ groups }`: no name, repos or badge flag.
- All sections ("Share all sections" in the inbox header's gear menu): `?shared-sections=` + same encoding of an array of
  `{ name, filter: { groups }, repos: [{ owner, name, forge? }], includeInTotalCount }`; max 500,000 chars.
- No clipboard-JSON or settings export exists.

## Docs
graphite.com/docs/use-pr-inbox ("Share sections"), graphite.com/docs/customize-pr-inbox. Default sections' filters live on the server.

## Gaps for GitHub search (INFERRED)
No qualifier for: file/line counts, forked repos, Source, MERGING, re-requested reviewers, "A bot" as a value, author-by-team.
APPROVED_BY / INCLUDES_PAST_REVIEWER / CLOSED_REVIEW_REQUEST_FROM only roughly match `reviewed-by:`. ORed groups need one
query per group (or the advanced `(a) OR (b)` syntax).

## Signed-in inbox page (OBSERVED 2026-10-09 by the user, signed in; not re-checked signed in)
- No request returns the section list (no `/api/v1/graphite/…sections` call); the inbox state arrives through the app's
  own sync. It lives in React state: a sidebar section `<li>` has a `__reactFiber$<random>` property, and ~40 steps up
  `fiber.return` a component's `memoizedProps` hold `{ snapshot, actions }`.
- `snapshot.sections[]`: `{ clientId: 'section/<id>', sectionId, name, repos: [{ owner, name, forge? }], usesDefaultRepos,
  filter, includeInTotalCount, totalUnpaginatedPrs, countsDegraded, sort: { method: 'updatedAt', direction: 'DESC' } }`.
- `snapshot.syncedRepos[]`: `{ owner, name, isInvalid, … }`, the inbox's "N repos selected"; sections with
  `usesDefaultRepos: true` search these instead of `repos`.
- `filter` is the server form, a tree of the same conditions: `{ kind: 'OR', exprs: [ { kind: 'AND', exprs: [ { kind: 'OR',
  exprs: [cond…] } | { kind: 'NOT', expr: { kind: 'OR', exprs: [cond…] } } ] } ] }`. Groups = the top OR's operands, rules =
  each AND's operands, a `NOT` = a negated rule. Example ("Needs anyone's review"): OR[ AND[ OR[status OPEN],
  NOT(OR[author dependabot, author DJCrossman]), OR[review REVIEW_REQUIRED_GITHUB] ] ], the share link's
  `is:open draft:false -author:dependabot -author:DJCrossman review:required`.
- Fibers are page objects: only a script in the page's main world sees them (an extension's isolated world does not).

## Signed out (VERIFIED 2026-10-09, throwaway profile, never signed in)
`https://app.graphite.com/` keeps its URL and renders the login card ("Welcome back to Graphite", "Log in with GitHub");
its data requests answer 401 and no `snapshot` exists. A `world: 'MAIN'` content script and an isolated one both inject
there, and a `<div>` appended to `<body>` causes no hydration error.

## How CarbonLayer copies the sections (IMPLEMENTED 2026-10-09)
Inbox dialog → `runtime.sendMessage({ kind: 'carbonlayer-open-graphite-import' })` → background opens
`https://app.graphite.com/` beside the asking tab and records `{ tabId, openerTabId }` in `storage.session` →
`entrypoints/graphite.content.ts` (isolated) asks the background whether its tab is that one → posts
`{ source: 'carbonlayer', kind: 'graphite-sections-request' }` → `entrypoints/graphite-sections.content.ts` (main world)
polls `li` elements for 30 s with `inboxSnapshotOf` (`src/lib/graphite.ts`) and posts the sections back (or an error) →
the isolated script relays them to the background → `storage.local.graphiteImport = { at, sections, defaultRepos }`
(or `{ at, error }`, leaving the tab open so signing in there finishes the copy) → the background re-activates the
asking tab and closes Graphite's → the dialog, watching that key, previews the views.

## Viewer, default repos, people (VERIFIED in B1's code 2026-10-09; not observed live)
- The signed-in user is a React context: module 840697 provides `value={…}` with `user`, read by `(0,a.Xn)().githubLogin`
  (module 460747); `user` also has `github: { login, id }`. The provider is an ancestor of the inbox, so a reader can walk
  on up from the `snapshot` holder to the first `memoizedProps.value.user.githubLogin`. Saved filters hold that literal
  login wherever the user picked "me".
- `usesDefaultRepos` is just `repos.length === 0` (`usesDefaultRepos:0===e.repos.length`).
- A section's optional `people` is a cache of display names for Graphite's people picker, not part of the filter.

## One GitHub search per section (2026-10-09)
The user verified, signed in, that `https://github.com/pulls/search?q=is:pr is:open ((author:@me draft:true) OR
(review-requested:@me -author:@me)) sort:updated-desc` returns results, so a section's groups are ORed in one query:
`is:pr <terms every group has> ((g1) OR (g2)) sort:updated-desc`. The outer parentheses matter because the inbox scope
is prepended as plain text. Groups that repeat or only add terms to another group are dropped first. GitHub allows at
most five AND / OR / NOT operators in a query; past that a section is split into one view per group. A group's PR-status
rules are intersected as one set of states (so `is:open` and `is:closed` never meet), and "is not Merging" excludes
nothing: Graphite's merge queue is part of GitHub's open.

## Verified mapping (2026-10-09, compared section by section against the user's live Graphite inbox and GitHub's dashboard search)

GitHub's dashboard search (`/pulls/search?q=`) uses the advanced syntax: repeated `repo:` terms are ANDed (→ 0
results), so several repositories must be written `(repo:a OR repo:b OR repo:c)`; parentheses and `OR` work.

| Graphite | GitHub search | Evidence |
|---|---|---|
| `CONSOLIDATED_PR_STATUS_IS: OPEN` | `is:open` (**includes drafts**: Graphite's Drafts section is "Open AND Draft") | Drafts section 9/9 with `is:open draft:true author:@me` |
| `DRAFT` / NOT DRAFT | `draft:true` / `draft:false` | same |
| `MERGING` | no equivalent: positive → drop the whole group (note); negated → nothing | "Merging and recently merged" group 1 |
| `MERGED` | `is:merged` | |
| `CLOSED` | `is:closed -is:merged` | |
| `AUTHOR_IS` a \| b (one rule) | `(author:a OR author:b)`; negated: `-author:a -author:b`; `dependabot` → also `-author:app/dependabot` | "Waiting for POMS reviewers" 1/1 |
| `OPEN_REVIEW_REQUEST_FOR` me, `REOPENED_REVIEW_REQUEST_FOR` me | `review-requested:@me` (negated `-review-requested:@me`) | |
| `CLOSED_REVIEW_REQUEST_FROM` me | `reviewed-by:@me -review-requested:@me` | |
| `APPROVED_BY` me | `reviewed-by:@me -author:@me` | "Waiting for author" 5/5 once `-author:@me` is added |
| `REVIEW_STATUS_IS: IS_FULLY_APPROVED` / `ONE_OR_MORE_APPROVALS` / `APPROVED_GITHUB` | `review:approved` | "Approved" 4/4 |
| `HAS_UNADDRESSED_CHANGES_REQUESTED` / `HAS_CHANGES_REQUESTED` | `review:changes_requested` | |
| `REVIEW_REQUIRED_GITHUB` | **`review:none`** (not `review:required`: 18/18 vs 12/18) with `draft:false` | "Needs anyone's review" |
| `HAS_ACTIVE_REVIEW` | positive: `(review:approved OR review:changes_requested)` (an alternative, distributed over the group); negated: `-review:approved -review:changes_requested` | "Waiting for reviewers" 2/2 |
| `HAS_ONE_OR_MORE_REQUESTED_REVIEWERS`, `HAS_REREQUESTED_REVIEW` | unsupported | |
| `LAST_UPDATED: h` (less than) | with `MERGED` in the group: `merged:>={{Nd}}`; else `updated:>={{Nd}}`; `{{Nd}}` must resolve to an ISO timestamp (`2026-10-02T14:40:00Z`), not a date — a date-only window over-counts (161 vs 141) | "Merging and recently merged" |

The user's 9 sections (their server-form filters) are the fixture to keep green: Needs your review (3 groups → one query
`-author:@me is:open draft:false review-requested:@me -review:changes_requested`), Returned to you, Approved, Waiting for
reviewers, Drafts, Waiting for POMS reviewers, Needs anyone's review, Merging and recently merged, Waiting for author.

## GitHub's repository picker
`GET /repositories/picker/search?q=<text>` (same-origin, signed in; the dashboard sends `q=contributed-by:@me` on open)
returns the repositories the picker lists; each item is `{ id, nodeId, name, ownerLogin, visibility }`. Shape of the
envelope unconfirmed (parse tolerantly: an array, or `{ repositories }`/`{ items }`).
