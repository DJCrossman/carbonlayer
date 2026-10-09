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
