# Graphite web app: UI conventions to copy

Graphite does not publish a full shortcut list, and it never defines what puts a PR into each inbox section except "Needs your review". So anything below about j/k, `?`, next-file keys or section membership other than that one is inference, marked I. V means verified; the bracketed key points to a source URL at the end. The PR page was redesigned in Nov 2025, so anything marked "legacy" (2021–23 docs) describes an older layout.

## A. Inbox

**Sections**
- The docs list six, in this order: Needs your review, Approved, Returned to you, Merging and recently merged, Drafts, Waiting for review [IN].
- The screenshot on that same docs page shows seven, in a different order: Needs your review, Returned to you, Approved, Drafts, Waiting for reviewers, Merging and recently merged, Waiting for author [IN-img].
- Use the screenshot's seven.

| Section | Who lands here | GitHub search |
|---|---|---|
| Needs your review | V [CU-img]: author is not me AND includes reviewer (directly or via team) me AND review status is not Draft or Approved AND PR is Open | `is:pr is:open draft:false review-requested:@me -author:@me -review:approved` |
| Returned to you | I: my PRs with changes requested (2021 "Needs your attention") | `is:pr is:open author:@me review:changes_requested` |
| Approved | I: my approved PRs | `is:pr is:open author:@me draft:false review:approved` |
| Drafts | I: my drafts | `is:pr is:open author:@me draft:true` |
| Waiting for reviewers | V-legacy [OLD]: my PRs waiting for review | `is:pr is:open author:@me draft:false review:none` |
| Merging and recently merged | I | `is:pr author:@me is:merged merged:>=<date>`, plus open PRs with auto-merge or a merge-queue entry (GraphQL `autoMergeRequest` / `mergeQueueEntry`) |
| Waiting for author | V-legacy [OLD]: others' PRs I approved or requested changes on | `is:pr is:open -author:@me reviewed-by:@me -review-requested:@me` |

**Must be computed client-side**: CI state (required checks), merge conflicts (`mergeable` / `mergeStateStatus`), unresolved thread counts, stack position (chain base→head), review age, unread state, auto-merge / merge-queue state.

**What each row shows**
- Legacy (V-legacy [OLD]), left to right: approval status, title and author, stack position `4/5` (click opens a stack modal), CI, mergeable, +/− lines, last updated. Default sort: last updated desc; title and size also sortable.
- Current (V [IN-img]): each section is a collapsible card headed "Name N"; empty section shows "Name - No pull requests" in grey. Column header icons: check-circle (review state), person (author), then sortable "Title ⇅". Each row: blue dot (I: unread), green person-check (approved), avatar, title bold, `author • owner/repo #176` under it. Sidebar: repo picker, sections with counts, "+ Add section".
- Overdue review time in red, except on closed/merged PRs [CL-4/25/24].

**Status vocabulary** (V [PP-img], [FP])
- Pills: green "Ready to merge", "Ready to merge as stack", "Waiting on downstack"; orange "Unresolved comments"; red "Required checks failed", "Closed"; purple "Merged"; "Waiting on your review" (colour unknown).
- Thread counter resolved/total, e.g. `0/3`. Ages compact: `18m`, `13h`, `4d`. Lines +green / −red. Approved reviewer gets green ✓. Checks: green/grey segmented bar; pending gets a clock icon.

**Custom sections** (V [IN], [CU-img])
- ⚙️ on a section header opens a modal: Name; Repositories (default or override); Filters ("Add condition" rows joined by And; "Add filter" adds groups, I: ORed); checkbox "PRs in this section add to the favicon badge count"; Delete / Cancel / Save.
- Filter fields seen: author's username is/is not, includes reviewer (directly or via team), review status is/is not, PR status is.
- Sections reorder by drag and drop. "Share filters" makes a link; it can swap in the recipient's own username; one-way snapshot. ⌘K opens fuzzy PR search.

## B. PR page ([CL-11/20/25], [PP], [FP])

**Header**: `repo #N` and title. Author, `head → base` branch chip, file count, +/−, "Updated 18m ago". Top right: "Finish review" with pending-count badge, `…` menu, thread count, Chat.

**Main column, top to bottom**
1. **Stack**: collapsible, labelled "Stack 3 of 4". Vertical rail, tip at top, "main (trunk)" at bottom. Current PR has a filled dot. Each row: #, title, thread count, status pill, age.
2. **Description**: rich text.
3. **Discussion**: PR-level comments.
4. **Diff**: file tree on the left (F toggles; collapsed leaves a mini-tree). "Compare Base → v4" and "File settings" above the diff. All files scroll as one continuous page.

**Right column, top to bottom**
1. **Status card**: "Open" plus **Merge when ready** toggle.
2. **Action cards** naming the next step: "Unresolved comments – 2 threads need resolving before this PR can merge [View comments]", "Waiting to merge", "Merged [Revert merge]", "Ready to merge as stack [Merge 2 PRs]".
3. AI-review card.
4. **Checks**: re-run, View all, progress bar, rows that open the check on GitHub.
5. **Reviewers**: ↻ re-request, + add, ✓ per approver.
6. Labels, Assignees, Related tasks, Preview link.

**Diff details**
- File header: path, +/−, language, **Viewed** checkbox, comment icon, `…` menu.
- Context expanders "↓ 17 lines" and "All lines in file".
- Comments float to the right of the code rather than inline; show avatar, age, reactions, "Show N replies".
- Comment on any line: hover line number, or drag for a range. ⌘↵ posts immediately; "Add to review" batches it and raises the Finish review count.
- Threads can be resolved [RV]. Comments from older versions are marked stale [CL-2/15/23]. Scrollbar shows comment markers [CL-5/3/23].

**Review and merge**
- Review popover: textarea, radios Comment / Request changes / Approve, blue "Submit review ⌘↵". A review bar is pinned at the bottom.
- Purple **Merge** button depends on stack position [MG]: bottom PR "Merge"; middle "Merge N" (merges 1..N); top merges the whole stack.
- Merge modal: strategy, commit message, admin bypass. Merge queue → queue modal with fast-track [MQ].
- Merge when ready is disabled when already mergeable; at top of stack asks whether to apply to PRs below [MWR].

## C. Keyboard shortcuts

**Verified**

| Key | Action | Source |
|---|---|---|
| ⌘K | PR search / command bar | IN |
| F | toggle file tree | PP |
| S | stack navigator | RV |
| T / C | timeline / threads panel (legacy) | UP |
| V | toggle version compare | VER |
| R C / R N / R A | open review as Comment / Request changes / Approve | PP |
| R Y | quick-approve, no comment | PP |
| ⌘↵ | post comment; submit review | PP |
| ⌘↵ | mark file viewed | CL-4/10/24 |
| ⌘⇧↓ | move down the stack | BP |
| E R | edit reviewers (2021) | OLD |

A shortcut legend is shown at the bottom of the PR page [CL-5/3/23].

**Inferred**: ⌘⇧↑ up the stack; j/k and Enter in the inbox; n/p next/previous file; a key for next unresolved thread; `?` help overlay; `g`-prefixed chords. No key documented for merge or "open on GitHub". Graphite lets you swap github.com and graphite.com in a PR URL [CL-11/4/25].

## D. Signature behaviors worth copying
- Stack-aware status pills and the Merge N button.
- Pending mergeability check on PRs higher in the stack [MS].
- Action cards that each name one next step.
- PR versions (v1…vN) and "hide reviewed changes" [VER].
- Orange bar marking code that changes again higher in the stack [BP].
- Indicators for "CI failing lower in the stack" and "author needs to restack" [CL-3/13/24, CL-4/10/24].
- Re-run only failed CI jobs. Comment drafts recovered after reload [CL-4/18/23].
- Favicon badge count, overdue review times in red, unread dot.
- Title and description centered at a max width; dense rows. Sticky file headers: I.

## Sources
- IN: https://graphite.com/docs/use-pr-inbox
- CU: https://graphite.com/docs/customize-pr-inbox
- PP: https://graphite.com/docs/pr-page-overview
- UP: https://graphite.com/docs/update-pull-requests
- RV: https://graphite.com/docs/review-pull-requests
- VER: https://graphite.com/docs/pull-request-versions
- MG: https://graphite.com/docs/merge-pull-requests
- MWR: https://graphite.com/docs/merge-when-ready
- MQ: https://graphite.com/docs/get-started-merge-queue
- MS: https://graphite.com/docs/mergeability-status-check
- BP: https://graphite.com/docs/best-practices-for-reviewing-stacks
- FP: https://graphite.com/features/pr-page
- OLD: https://github.com/withgraphite/docs (guides/graphite-dashboard/*, 2021)
- CL: https://graphite.com/blog/ changelog-nov-20, changelog-november-4, graphite-changelog-5-03-23, graphite-changelog-4-18-23, product-update-2-15-23, graphite-updates-3-13-2024, graphite-updates-4-10-2024, graphite-updates-4-25-2024
