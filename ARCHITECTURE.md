# CarbonLayer — architecture

A Chrome (MV3) extension, built with WXT + React 19 + TypeScript, that re-renders two GitHub
surfaces in the style of Graphite:

1. **Inbox** on the GitHub homepage, `https://github.com/`, when signed in — several configurable, shareable
   "views" (each view is a GitHub search query) rendered on one page with review / CI / merge status per PR. GitHub's
   own pull request dashboard under `/pulls` stays GitHub's.
2. **PR page** at `https://github.com/<owner>/<repo>/pull/<n>[/…]` — stack at the top, a single
   vertical scroll (description → activity → diff), CI / reviewers / merge status in a right sidebar,
   diffs rendered with `@pierre/diffs`, Graphite keybindings.

## Why an iframe, not a shadow root

`@pierre/diffs` cannot run in a content script: Chrome's isolated world has no `customElements`
registry (the library defines `<diffs-container>` at import time) and WXT bundles content scripts as
one IIFE, which inlines every Shiki grammar (11 MB). See `docs/research/pierre-diffs.md`. So the UI is
an ordinary extension page, `app.html`, embedded into github.com with WXT's `createIframeUi`. The page
has a real custom-element registry, ESM code-splitting (grammars load lazily), and the extension's own
CSP. The content script is a thin bridge.

## Entry points (`entrypoints/`)

| file | role |
| --- | --- |
| `github.content.ts` | Content script on `github.com/*`, run at `document_start`. Recognises the inbox (the homepage `/`, only when `<meta name="user-login">` names a signed-in user: signed out, `/` is GitHub's marketing page and stays untouched, so at `document_start` the script waits for that tag, or for `<body>`, before hiding anything) and PR (`/:owner/:repo/pull/:n`, plus `/files`, `/changes`, `/commits`, `/checks`) routes (`src/app/routes.ts`). On a handled route it reads the settings, then hides GitHub's `main` with a `<style>` on `<html>` before the page paints, and mounts the iframe (`app.html?theme=<theme>#<route>`) on `<html>` too, below GitHub's header, so Turbo's `<body>` swaps leave both in place and a soft navigation moves the loaded app with `gg:route` instead of reloading it. The frame opens in the theme the app will show (the options' theme, else GitHub's), which `app-theme.ts` puts on before the first paint: the app's light default would otherwise show while its code loads, a white flash on GitHub's dark theme. It forwards theme, keydown, the window's focus and who is signed in (`gg:viewer`, answering the app's `gg:ready` with `<meta name="user-login">` once the parser has reached it) to the iframe, performs top-level navigations the iframe asks for (`src/app/bridge.ts`), answers the iframe's RPC requests with `handleRpc` from `src/lib/github-web/` (session fetches), and re-routes on every same-document navigation (the Navigation API's `navigate` event; `wxt:locationchange` where there is none). A page the app asks for that it shows in this tab moves the tab inside the app instead of loading (below, "Moving between pages"). `?gh=1` leaves GitHub untouched for one visit. The `inboxEnabled` / `prEnabled` settings leave it untouched until switched back. On every handled route the script adds a "GitHub \| CarbonLayer" switch (`role="group"`, two `aria-pressed` buttons, plain DOM, GitHub's colour variables) to GitHub's header, just before the + / notifications cluster (`[data-testid="top-bar-actions"]` in the signed-in global nav, `.AppHeader-actions` on older headers; signed out, the marketing header's search-and-sign-in cluster; failing those, the header's end). A click switches this tab at once (GitHub's view loads the URL afresh when the app moved the tab since the page loaded, as GitHub's page below it is another URL's) and keeps that choice in the tab's `sessionStorage` for as long as the tab lives, and saves it as the default for tabs opened later; other open tabs keep their page until they load again. The popup's switches do the same for the tab in view: they save the default and send that tab's content script a `gg:choose` runtime message. GitHub's headers are server-rendered React partials, and a node inserted among their children before hydration makes React render the header again without it, so the switch lives in an open shadow root on that cluster beside a `<slot>` for GitHub's own children; it is placed once the header is parsed and again after a Turbo `<body>` swap or a React re-render. |
| `app-theme.ts` | `app.html`'s first script, a blocking one in its `<head>`: sets `<html data-theme>` from `?theme=` (`themeOpenedIn` in `src/app/frame-theme.ts`, which imports nothing, so the script stays a few hundred bytes) before the page is parsed or painted, and `app/main.tsx` keeps that theme until it has GitHub's (`gg:theme`) and the options' own. A file of its own (WXT unlisted script), since the extension's CSP blocks inline scripts. |
| `app/` | The React app (`entrypoints/app/main.tsx`): hash router → `InboxPage` (`src/inbox/`) or `PrPage` (`src/pr/`), inside the page's TanStack Query cache (`PageQueries`, below), which a move to another page (`gg:route`) keeps; another page or PR opens at its top. Data comes through a `DataSource` (`src/app/data-source.ts`): the RPC-backed one in the extension, a fixture-backed one when opened with `?fixtures=1` (the dev harness). Listed in `web_accessible_resources` for `https://github.com/*`. |
| `background.ts` | Brokers the one-click copy from Graphite: opens `app.graphite.com` next to the inbox's tab, remembers both tabs in `storage.session`, stores the copied sections under `graphiteImport` in `storage.local`, then closes the Graphite tab and re-activates the inbox. And runs the stack merges the merge dialog starts, and those "Merge when ready" arms where GitHub has no stack auto-merge for the repository (below, "Merging a GitHub-native stack"). |
| `graphite.content.ts` / `graphite-sections.content.ts` | On `app.graphite.com`, only in the tab the background opened: the isolated script asks the page-world script (`world: 'MAIN'`) for the inbox's sections; that one waits for the inbox to render, walks React's internal state above a sidebar item to the inbox `snapshot` (`inboxSnapshotOf` in `src/lib/graphite.ts`, which reads each fiber's props by zod schemas) and posts the sections, the inbox's repositories and the signed-in login back, the copy read as `graphiteInboxSnapshot` (every section named, the rest as Graphite holds it) at each hop: the page world, the isolated script and the background. A snapshot of another shape is reported, saying what differs, rather than copied. A banner in the tab reports the result. |
| `options/` | Options page: the inbox's organization, its repositories and views editor, merge method, diff layout, theme, on/off switches. |
| `popup/` | Toolbar popup: on/off toggles, links to inbox and options. |

## Data flow: the user's github.com session, no token

App (iframe) → `window.parent.postMessage` RPC (`src/lib/rpc.ts`) → content script on github.com →
`src/lib/github-web/` makes same-origin fetches against the JSON endpoints GitHub's own React UI
uses (`/pulls/inbox/queries`, `/pulls/search`, `/pulls/…/deferred`, `/{o}/{r}/pull/{n}/page_data/*`,
`/repositories/picker/search`, the pages' embedded `react-app.embeddedData`) with the session cookies → normalised domain objects
(`src/lib/model.ts`) are posted back. Writes go to the `page_data/*` routes GitHub's PR page posts
to (reopening a closed PR is `page_data/reopen_pull_request`, after `page_data/restore_head_ref` where its branch is gone;
reverting a merged PR is an empty POST to `/pull/{n}/revert`, as GitHub's Revert button sends, landing on GitHub's
prefilled page for the revert pull request), except re-running checks: the PR page cannot, so `github-web/actions.ts` submits the classic form in the re-run dialog of
GitHub's Actions run page. Reactions are a classic form too: `pr.react` posts the `form.js-pick-reaction` GitHub's
conversation renders under each comment to `/{o}/{r}/reactions`, with the token the header stage read from one of those forms,
while the page shows the reaction at once (`src/pr/Reactions.tsx`). Pointed at, a reaction opens GitHub's card of who gave it,
each by avatar and login, the viewer first, then how many more, from a diff comment's `reactors` in `page_data/threads` and
from the `<tool-tip>` GitHub's conversation renders for each reaction button (ten names at most, the rest counted); the
tooltip's sentence, the viewer first as You, is the pill's description, and its tooltip where GitHub names nobody. An edited comment is saved as GitHub's React page saves
it: the description as `page_data/update_description`, a diff comment as `page_data/update_review_comment`, and a
conversation comment or a review's summary as form fields to its own address (`/issue_comments/{id}`,
`/pull/{n}/reviews/{id}/update`), each with the comment's version when the edit started where the page gave one, so that
GitHub refuses an edit made over a newer one. The viewer's own comments, where GitHub lets them delete them, offer Delete
last in the comment's ⋯ menu (see Comment menus below), asked first as GitHub asks: a diff comment goes as GitHub's files view
deletes it, `DELETE page_data/review_comments/{id}`, and a conversation comment as its Overview does, `DELETE
/issue_comments/{id}`; another's comment offers none, even to a repository's admin, and no review can be deleted. A comment box's Preview tab is GitHub's own rendering: the multipart POST to
`/preview` GitHub's comment box sends for a comment on the PR (`markdown.preview`), which changes nothing. The comment
boxes themselves (`CommentInput` in `src/pr/primitives.tsx`) work like GitHub's: its toolbar, shortcuts, lists that
continue and links on paste, each a pure command in `src/pr/markdown-editing.ts`, and the emoji GitHub's box suggests
after a `:` that starts the text or follows whitespace, ranked and put in as GitHub does (`emojiSuggestionsFor`,
`insertEmoji`: a Unicode emoji's character, `:name:` for one of GitHub's own) from the list GitHub's box loads
(`markdown.emojis`: `GET /autocomplete/emojis_for_editor`), asked the first time a box asks for one and then kept by the
page's cache (`['emojis']`, on the device too, for its 24 hours). A typed `:+1:` stays text, which GitHub renders. An `@`
the same way suggests the PR's people and teams from the list GitHub's box loads for it (`markdown.mentions`:
`GET /suggestions/pull_request/<id>`), ranked CarbonLayer's way (`mentionSuggestionsFor`) and put in as `@login` or
`@org/slug` (`insertMention`), asked the first time a box asks for one and kept per PR (`['mentions', prId]`, fresh for
five minutes). A `/` at the start of a line lists GitHub's slash commands (`SLASH_COMMANDS`, `slashCommandsFor`), filtered
by GitHub's fuzzy score, each putting in the Markdown GitHub's server answers it with, after a second step for most;
Saved replies' step lists the viewer's saved replies from the list GitHub's box loads (`markdown.savedReplies`:
`GET /settings/replies?context=pull_request`, without `GitHub-Is-React`), asked the first time a box opens it and kept
in memory only (`['saved-replies']`, fresh for five minutes). See
`docs/research/github-web-endpoints.md`, `github-web-mutations.md` and `github-web-reviewers.md`. No api.github.com, no token. The background service worker brokers the one-click copy from Graphite (below), and runs
stack merges, whose requests go through a github.com tab's content script all the same (below).

Signed-in state comes from the fetched PR page's `meta[name="user-login"]`: empty means the PR page
shows "Sign in to github.com in this tab". Signed in, the routes behind the sidebar (`merge_box`,
`status_checks`, `stack_mergeability`, `review_requests`, `labels`, `assignees`, `description`) and
the inbox's deferred fields are side details: on the PR page a 404 from one is logged with `console.debug('[gg]', …)`
and leaves that card empty (an open PR's checks card says why), and any other failure shows in the card with a retry.
The page's own cache (below) decides when to ask again, so the content script asks GitHub every time, except the
reviewer picker's searches and `pr.fetch`, kept 60 s and 30 s; a successful write clears those.

Every answer GitHub sends is read by a zod schema of the fields its reader reads, kept next to that reader:
`getJson(path, schema)` and `embeddedPayload(page, routeKey, schema)` parse with it (`readAnswer` in
`src/lib/github-web/session.ts`, which the one write whose answer is read, a stack merge's `enqueue_stack`, uses too), and
other keys are left unread. A field is required only where the reader cannot do without it; what GitHub may leave out or
send as null is optional, as the reader already treated it. An answer of another shape throws `<endpoint> did not match:
<zod's issues>`, and takes the reader's own way to the page: a PR page stage fails with its Retry, an inbox section shows
it in place of its rows, and where a failure was already tolerated (the inbox's deferred fields and row details, a stack
entry's conversations and author, "Group by stack"'s branches, the organizations' repository source) it is logged with
`console.debug('[gg]', …)` and that part stays as it was. Where the docs record no place for what a reader needs (a
section's deferred rows, how many approvals the rules require, the repository picker's envelope), it is looked for by
name wherever GitHub nests it (`findInPayload`) and what is found is read by the schema.

What crosses between the extension's own parts is read the same way, by zod schemas, and the types are the schemas'
(`z.infer`): the domain model (`src/lib/model.ts`) is schemas, which the app reads the content script's answers by; each
RPC method has a schema for its args and one for its result (`RPC_SCHEMAS` in `src/lib/rpc.ts`, from which `RpcMethods`
is derived). The content script reads a request's args by its method's (`readRpcRequest`) and answers one of another
shape, or an unknown method, as that request's failure; the app reads an answer's result by its method's (`rpc`) and
rejects one of another shape with `The answer to <method> did not match: <zod's issues>`, which takes the query's own
way to the page. The bridge's messages are two discriminated unions (`parentToAppMessage`, `appToParentMessage` in
`src/app/bridge.ts`): the frame leaves alone what does not parse, since GitHub's own page posts to it too, while the
content script, which hears only the frame (origin and source checked), throws on a message of another shape. The
background's runtime messages, the popup's `gg:choose` (the content script ignores runtime messages of other shapes) and
what the inbox and the stack card read back from the page's cache (a section's rows, a row's details) are read the same
way. The schemas are `zod/mini`'s, which loads no error messages of its own: every entrypoint that parses imports
`src/lib/zod-messages.ts` first (vitest through `setupFiles`), or a failure reads only "Invalid input".

Graphite judges CI from every check run on the head commit, runs of the workflows GitHub triggers itself (event `dynamic`,
such as Copilot's code review) included, while `status_checks`, the commit's status rollup and the PR's Checks tab all
leave those out. So the PR page's checks and the inbox's open rows also read the branch's Actions list
(`/{o}/{r}/actions?query=branch:<head> event:dynamic`, HTML) and count the newest failed, cancelled or unfinished run of
each such workflow whose run page names the head commit as a check that is never required (`dynamicWorkflowChecks` in
`src/lib/github-web/actions.ts`, kept 5 minutes a commit; a failure counts none).

## The page's cache

Each page's data goes through one TanStack Query client (`PageQueries` in `src/app/query-cache.tsx`). A tab's moves
between the inbox and PR pages keep the app, and its cache in memory, diffs and comments included (below; a PR's timeline,
files, threads and diffs for 30 minutes once no page shows them, `IN_MEMORY_FOR_MS`); every page load
(a new tab, a reload) starts the app afresh, so the cache is also kept on the device: a page shows what the viewer saw
last at once, then asks GitHub and updates in place. It lives in the extension's own IndexedDB (database `carbonlayer`,
one entry for the whole cache, shared by every tab, written at most once a second), restored before the page's queries
run. It is kept for whoever is signed in: the content script answers the app's `gg:ready` with the login (`gg:viewer`), and
the cache is kept under `<extension version>:<login>:<build>`, so another account, version or build finds nothing (and
the old entry goes): every build has an id of its own, the time it was made (`import.meta.env.BUILD_ID`, defined in
`wxt.config.ts`), since one build's cache may not be what the next one reads, and the manifest's version stays the same
from build to build. Signed out, the page has an in-memory cache only. The page never waits on either for long: a frame
`gg:viewer` has not reached within two seconds renders with an in-memory cache, and IndexedDB is given a second for each
read or write (an open can wait for good behind another tab's upgrade), after which the page restores nothing and asks
GitHub, or stops waiting for the save. What it reads there must be the string a save wrote, holding a cache of the shape
this build saves (`keptCacheSchema`: the buster, and each query that loaded with its key and state), else the entry is
discarded and the page asks GitHub. Only what loaded is kept, for 24 hours, and never a diff or a
comment: the PR page's file list (GitHub sends some diffs with it), diffs, review threads and timeline stay in memory and
are asked of GitHub on every page load (`keptOnDevice`). The settings are a query of the cache too (`useSettings` in
`src/app/use-settings.ts`, kept current by `watchSettings`), in memory only, since chrome.storage keeps them: the inbox and
the PR page read them from it, so a move between them waits for nothing. The page renders once the cache is back, so its
first frame shows what it holds rather than skeletons. Failures are not retried; each shows where it happened. A page
that throws while rendering never leaves the frame blank: `PageErrorBoundary` (`entrypoints/app/main.tsx`, one around the
page shown, so another page starts without its error) logs the error with `console.error`, shows "This page could not be
shown" with the error's message and a Reload (the frame's own `location.reload()`), and, since what the device kept is the
likeliest cause, forgets it (`forgetKeptCache`: the IndexedDB entry cleared, and nothing more saved from that page), so
the reload asks GitHub for everything. The options page has a cache of its own, in memory only.

Coming back to the page (the tab shown, the window focused, this frame's own or github.com's forwarded as `gg:focus`)
asks GitHub again for every query on the page older than its `staleTime` (TanStack's `focusManager`, given those three
listeners). Where GitHub answers several things in one request (a PR's diffs, the inbox's sections, its rows' details
and branches) each still has a query of its own, and what the queries ask for in the same moment goes together
(`askedTogether` in `src/app/asked-together.ts`).

The inbox's queries: each section (`['inbox', org, scope, view id, query, limit]`, 30 s), each "Load more" page
(`['inbox-page', org, scope, query, limit, page]`), each row's details (`['inbox-row', id, updatedAt, state, draft, CI
rollup, merge method]`, 2 minutes, which the PR page's stack card asks too), each open PR's branches (`['stack-branches', owner, repo, number]`),
each shown PR's place in Graphite's stack (`['graphite-stack', owner, repo, number]`, until the row is updated), the
organizations (`['orgs']`), an organization's people (`['org-people', org]`) and the top repositories
(`['top-repositories']`, pages of one infinite query), 10 minutes each, and the repository picker's searches (`['repos',
org, text]`, a minute). All of them are kept on the device.

What the inbox and the stack card know about a PR makes opening it instant. Resting the pointer on an inbox row or a
stack entry for 150 ms, or selecting a row with j / k, loads that PR's page through the same queries the PR page uses
(`prStageQuery` in `src/pr/page-data.ts`): every stage, asked together as the page asks them, then, once the header and
the file list are in, the diffs GitHub did not send with it; the stages kept on the device (`KEPT_STAGES`: header,
stack, merge box, checks, labels) are saved there as soon as they have loaded, while the timeline, files, threads and
diffs stay in this tab's memory, for a move inside the app. One PR at a time, the latest intent first, three waiting at
most, none whose stages are 30 s fresh, the next waiting only for the kept stages (`useLoadAhead` in
`src/pr/page-data.ts`). The cache is saved within a second of a change; it is saved at once (`SaveCacheNow`) when such a
PR's kept stages have loaded, before a row opens its PR (the move waits for it), and as the page goes (`pagehide`, which
an unloading page does not always finish). A PR page whose stages the cache does not have uses what the inbox or a stack
showed of it as TanStack placeholders, never cached and never fresh (`stagesStandingIn`): the inbox's row, else its entry
in the latest stack the page showed that names it (a neighbour opened from the stack card), gives the header (branches
from the row's details or its stack lookup; the description shows a skeleton until the page's own header; an entry whose
author GitHub did not name gives none); the row gives the labels; that stack, centred on the PR, the stack card; and once
the PR's row details were found, its reviewers and merge status and its checks. A stage standing in so is `placeholder`:
the sidebar's next step waits for the real one, and each is replaced as its own answer arrives.

The PR page loads in stages (`PrStages` in `src/lib/model.ts`, `src/lib/github-web/pr-stages.ts`), all requested at
once and each rendered as it arrives (`src/pr/page-data.ts`, one query per stage, `['pr', owner, repo, number, stage]`): `pr.fetchHeader` (the page's HTML, `tab_counts`,
`diffstat`; the description is the conversation's first comment, `page_data/description` only without one),
`pr.fetchActivity` (the timeline from that HTML, `threads` for which review opened which), `pr.fetchFiles`
(`base_comparison_info`: every file, with the diffs GitHub sends along), then `pr.fetchFileDiffs` for the rest, one query
a file (`['pr-diff', owner, repo, number, headOid, baseRef, path]`, fresh for good: the same commit has the same diff),
asked 20 paths a `diff_entries` request and four requests at a time in the order the files show (those the cache has for
the head the cached header names show at once; asking waits for a header GitHub sent the page), `pr.fetchThreads` (`threads`
placed by the comparison's markers), `pr.fetchMergeBox` (`merge_box`, `review_requests`), `pr.fetchChecks`
(`status_checks`), `pr.fetchStack` (each open entry's own `stack_mergeability` from the bottom of GitHub's stack up to
the PR, or Graphite's comment and the author's open PRs, then every
other entry's own `threads`, for its conversation counter, and, where the stack's listing did not say who opened it,
its `page_data/header`, three entries at a time) and `pr.fetchMeta` (`labels`, `assignees`). The content script asks
GitHub for every stage every time, and shares a request between the stages that make it while it is on its way, so the
HTML is fetched once for the stages asked together; after a successful write it shares none made before it. Opening
the page asks GitHub for every stage, whatever the cache had. Until the header arrives (from the cache, the inbox's
row or a stack entry, or one round trip) the page is a skeleton, and the window's title the PR's number; after it each section has its own skeleton and, should its stage fail before it ever
arrived, an inline error with a retry. Only a signed-out header with nothing to show fails the whole page. A write
invalidates the stages it changes (`STAGES_A_WRITE_CHANGES` in `src/lib/rpc.ts`) and the page loads those again, the
others untouched (a reload that fails says so in a toast); marking a file viewed only changes it in place. Coming back to
the page once a stage is 30 s old loads it again in the background, every stage but the files, each part keeping what
it shows until its answer arrives and as it was should that fail; the file list loads again only once a header GitHub
sent this page finds the head commit moved or the base changed, and each file keeps its diff until the new one arrives.
`pr.fetch` still answers the whole `PrDetail` at once, composed from the stages.

Moving between pages: in a tab the app has taken over, a move to another page the app shows there (an inbox row, a
stack entry or its keys, the sidebar's "Go to #n", a github.com link in Markdown to a PR or the homepage) stays in the
app. The app asks the content script to navigate (`gg:navigate`), as it always has; when the URL is one the app shows in
this tab (`routeInApp` in `src/app/routes.ts`: github.com, the surface switched on here, the homepage only signed in),
the content script `history.pushState`s the top window to it, a `null` state, notes the new entry's key, and posts the
route (`gg:route`): the app switches page with the same cache, so the address bar shows the real github.com URL, the
window's title follows (`gg:title`, which each page posts from its first frame) and nothing loads. Back and Forward are
same-document navigations: the Navigation API's `navigate` event syncs the route as for GitHub's own soft navigations.
GitHub's page below the app stays the one the tab loaded, and so does its header above the app (its breadcrumbs name
the repository of the page the tab loaded). GitHub's Turbo restores only entries carrying its own state
(its `shouldRestore` hook, read from GitHub's bundle), so it leaves the app's entries alone; going back to the page the
tab loaded is a Turbo entry, which it may restore by fetching and re-rendering that hidden page, under the app. A
`popstate` landing on one of the app's entries is stopped before GitHub's listeners hear it (the content script listens
first, at `document_start`), so GitHub's React router does not take its hidden page there. Because GitHub's page is then
another URL's, the header's GitHub switch loads the current URL afresh after such a move (and shows GitHub's page in
place otherwise); `?gh=1` (`g h`) was a load already. Everything else still loads: a URL the app does not show (or shows
as GitHub's in this tab), ⌘ / Ctrl / Shift / middle clicks (the browser's own new tab or window, from the link itself;
an inbox row's through `window.open`), and a cross-document navigation, which leaves the old document's route as it was.
The PR page starts over for another PR (`PrStagesView` is keyed by it): scroll, drawer, collapsed files, composers and
any draft in a comment box belong to the PR they were on.

Skeletons show only where nothing is known: the cache (in memory after a move, on the device after a load) or a
placeholder stands in everywhere else. What remains: the page skeleton until a header exists (a PR neither the inbox nor
a stack showed, opened from a link or typed); the description until the page's own header (no row or entry has it);
the activity, the file list and each file's diff, the threads and the drawer for a PR whose page this tab has not loaded
in the last 30 minutes (they are never kept on the device); the labels and assignees for a PR known only from a stack entry; the sidebar's
"Checking mergeability…" line while its next step stands on placeholders (a merge button must not come from them); a
stack entry's statuses and an inbox row's columns until their first row details; a section's skeleton rows until its
first answer, or, grouped by stack, until its open rows' branches, Graphite places and stacks are known (or 15 s), so
that its context rows show with it rather than join it later (condensed and with no skeleton of their own, since they
ask for no row details; rows that join the section later join their stacks as those are answered); and the top
repositories until their first page.

Activity entries (`src/pr/Activity.tsx`) read as Graphite's Discussion: a review's header says its verdict as a verb,
"approved" in green, "requested changes" in red, "commented" or "dismissed their review" muted; a review without a body
is one line on its verdict's tint (`is-bar`), its inline comments link after its time, and one with a body keeps its card,
with a green or red left border for an approval or changes requested. A comment or review summary GitHub's conversation
marks edited (`.js-comment-edit-history` in its header, `edited` in `src/lib/github-web/timeline.ts`) says "(edited)"
after its time. Commits, force-pushes and review requests, which Graphite's Discussion leaves out, stay.

Comment links: every comment GitHub gives a permalink to has a Copy link (`CopyLink` in `src/pr/Comment.tsx`, a link
icon at the end of its header, or in the description's top corner, out of sight until the pointer is on the comment or
the keyboard reaches it) that puts the permalink on the clipboard and says so in a toast, as GitHub's "Copy link" and
Graphite's link icon do: the description's `…/pull/<n>#issue-<id>`, the link in its header that GitHub's own "Copy link"
copies (`descriptionPermalink` in `src/lib/github-web/timeline.ts`), a conversation comment's `#issuecomment-<id>` and a
review's `#pullrequestreview-<id>` (their elements' ids), and a diff comment's `url` from `page_data/threads`
(`#discussion_r<id>`), in the diff and in the comments drawer alike. A comment added to the review has none. Opening
such a link opens the page at the comment: the content script carries its anchor in the app's route
(`#/pr/<o>/<r>/<n>?comment=discussion_r<id>`, `comment` in `src/app/routes.ts`, GitHub's files-view `#r<id>` read as
`#discussion_r<id>`), and the page (`useLinkedComment` in `src/pr/PrPage.tsx`) waits for the stage that has it, opens a
diff comment's file and thread, scrolls the comment into view unless the reader already sees all of it, and marks it
(`is-linked`) as GitHub marks a linked comment, for as long as the route names it (GitHub's `:target`). A comment the
page does not show (hidden, or gone) leaves the page as it is, as does the reader scrolling, typing or clicking first.
A plain click on a comment's time, a link to its permalink as GitHub's is, does the same in place (`focusComment` in
`src/pr/navigation.ts`): the top window moves to the permalink inside the app, a history entry, so the address bar holds
the link to copy and Back takes the mark off; ⌘ / Ctrl / Shift / Alt clicks stay the browser's.

Editing comments: where GitHub lets the viewer edit a comment, its header has an Edit (a pencil before its Copy link, seen
as the Copy link is; the description's in its top corner), which puts GitHub's edit box in place of the comment: the comment
box (`CommentInput`) holding its Markdown, then Cancel and "Update comment" (`CommentEditor` in `src/pr/Comment.tsx`). ⌘↵
saves and Esc cancels; while GitHub saves the edit the box takes no input, then the stage the comment is in loads again
(`STAGES_A_WRITE_CHANGES`) and the box closes on the new text; a refused edit keeps its text and says why in a toast. The
conversation says who may edit what: a comment's or review's own options menu offers Edit only where the viewer may, its
Copy Markdown holds the Markdown, and a comment's `data-body-version` its version (`editableMarkdown`, `bodyVersion` in
`src/lib/github-web/timeline.ts`); a diff comment's come from `page_data/threads` (`viewerCanUpdate`, `body`, `bodyVersion`);
the description is the viewer's to edit where the title is (`editableDescription`), its Markdown from its own menu's Copy
Markdown or, where that gives none (as on signed-in pages it evidently does not) or the conversation renders no
description, from `page_data/description`'s `body`, asked only for a viewer who may edit it; should neither give it, the
header stage logs so (`[gg]`) and offers no Edit. See `docs/research/github-web-mutations.md`.

Comment menus: every conversation comment, review summary and diff comment (in the diff and in the comments drawer) has a ⋯
at the end of its header, after the Copy link and the Edit pencil, which stay, seen as they are (`CommentMenu` in
`src/pr/Comment.tsx`). It lists what GitHub's own comment menu lists, in its order, each item only where GitHub would offer
it and the page gave what it needs: Copy link (the permalink, as `CopyLink` copies it, with its toast); Copy Markdown (the
comment's Markdown as GitHub keeps it, `markdown`: a conversation comment's or review's from its own menu's Copy Markdown, a
diff comment's `body`; toasted alike); Quote reply (`quoteReply` in `src/pr/comment-menu.ts`: each line of that Markdown, or
of the reader's selection when it lies inside the comment's body as the menu opens, after `> `, then an empty line, appended
to the box the reply goes in, which scrolls into view and takes the focus at its end: the new-comment box at the foot of the
activity for a conversation comment or review summary, the thread's reply box for a diff comment, the drawer's opening if
need be; `CommentInput`'s `insertQuote` handle, typed in as a command is so ⌘Z takes it out); Reference in new issue
(`newIssueReferencing`: GitHub's new-issue page for the comment's repository in a new tab, its body the comment quoted and
"_Originally posted by @login in [#n](permalink)_", as GitHub's dialog starts it); a separator; Edit (the pencil's edit box);
Hide where GitHub lets the viewer hide the comment (`hideable`), which opens `HideCommentDialog` ("Choose a reason for hiding
this comment", GitHub's seven reasons in its order, "Hide comment"), or Unhide on a hidden one where they may (`unhideable`);
Delete, in red, on the viewer's own; then, after a separator, Report content on someone else's (`reportable`), GitHub's
report form in a new tab (`/contact/report-content?content_url=<permalink>&report=<login>+(user)`). Hiding goes as GitHub's
React page sends it (`pr.hideComment`, `pr.unhideComment`, `pr.hideThreadComment`, `pr.unhideThreadComment` in
`src/lib/github-web/mutations.ts`), and the stage the comment is in loads again. A hidden comment (`hidden`, with GitHub's
reason) keeps its header, menu included, then shows GitHub's line in place of its body and reactions, "This comment was
marked as off-topic." (or "This comment has been minimized." without a reason), with Show comment / Hide comment to toggle
it where the page gave its body. Who may hide, unhide and report: on the conversation, the comment's or review's own menu
holds GitHub's Hide (`.js-comment-hide-button`) and, the comment hidden (its `.minimized-comment` shown in place of it), its
Unhide form (`form.js-comment-unminimize`), its bar the reason (`menuIn` in `src/lib/github-web/timeline.ts`), and someone
else's is reportable by login; a diff comment's come from `page_data/threads` (`viewerCanMinimize`, `viewerCanUnminimize`,
`isHidden`, `minimizedReason`, `viewerCanReport`, `viewerCanReportToMaintainer`). A hidden conversation comment GitHub
renders without a body (signed out) is still left out. See `docs/research/github-web-mutations.md`, Hiding comments.
The description has the same ⋯ (`CommentMenu`, in its top corner after its Edit pencil and Copy link), listing what
GitHub's description menu lists: Copy link (`descriptionUrl`), Copy Markdown and Quote reply (`descriptionMarkdown`: its
menu's Copy Markdown, or `page_data/description`'s `body` where that was asked, as for editing above; Quote reply goes to
the activity's new-comment box, whose `CommentBox` handle `PrView` holds and passes to `Activity`, a selection inside the
description quoting only the selection), then a separator and Edit where `editableDescription` is set; no Reference in new
issue, Hide, Delete or Report content, as GitHub's has none.

File links: each file's header copies as Graphite's does (`FileCard` in `src/pr/Files.tsx`), each copy confirmed in a
toast. A click on its path copies the path: `@pierre/diffs` draws the path in the diff's shadow root, so the card hears
the click and finds the path in the click's composed path, and the library's `unsafeCSS` marks it on hover. The ⋯ at the
header's end starts, on a file whose diff shows and leaves lines out (not an added or deleted file's, the whole file
already), with Graphite's "Show all lines" ("Hide unchanged lines" once they show; see Unchanged lines), then offers Copy file name, the same, and Copy link, the link GitHub's files view gives the file,
`…/pull/<n>/files#diff-<the SHA-256 of its path, in hex>` (`fileAnchor` in `src/app/routes.ts`). Below them are GitHub's
own file menu's links, built as its files view builds them: View file (`…/blob/<head commit>/<path>`, a deleted file's at
the base commit), and Edit file (`…/edit/<head branch>/<path>?pr=/<owner>/<repo>/pull/<n>`, which comes back to the PR)
and Delete file (`…/delete/<head branch>/<path>`) in the head branch's repository (`headRepository`, a fork's for a PR
from one, from the PR page's `headRepositoryOwnerLogin` and `headRepositoryName`). GitHub offers those two to everyone and
its pages decide (offering a fork to whoever may not push); a deleted file, not on the branch, offers neither. They move
the top page, as GitHub's do. Opening such a link,
on `/files` or `/changes`, opens the page at the file: the content script carries the anchor in the app's route
(`?section=files&file=diff-<hash>`, `file` in `src/app/routes.ts`), and once the file list has the file whose path
hashes to it (`useLinkedFile` in `src/pr/PrPage.tsx`) the page keeps that file's card at the top while it grows, as it
keeps the files there for a link to them. An anchor no file has leaves the page at the files, and the reader scrolling,
typing or clicking before the file is found leaves it where they are. A link to a line of the diff opens the page at
the line: GitHub's anchor goes on with `L<n>` (line n of the old file, the deletions' side) or `R<n>` (of the new file,
the additions'), or a range, `R<n>-R<m>` or across the sides (`L10-R12`), which the route parses with the file
(`FILE_ANCHOR`, `fileLink`) into `lines` (`{ start: { side: 'LEFT' | 'RIGHT', line }, end? }`) and carries in GitHub's
own spelling (`&lines=R240-R250`). `useLinkedFile` then waits for the file's diff too, and once it has arrived the page
asks the files to reveal the lines (`revealLines` in `src/pr/Files.tsx`) instead of keeping the card at the top: should
the diff show them (inside its hunks, `takesComments`, and not a deleted file's, whose lines show only once asked), the
file expands, becomes current, and the lines are marked as selected lines are (the diff's `selectedLines`, which the
library only draws, firing none of the card's selection callbacks); then, as for a thread's line, the page moves toward
the line each frame (`scrollTowardLine`, a long diff drawing only the lines near the viewport) until the first marked
line number is drawn, centres it, and keeps it centred while the diffs above it arrive, for 3 s. The mark shows while
nothing is being selected and no composer is open for lines; it goes once the reader selects lines in that file (or
clicks the marked line, which unselects it) and when another link arrives. Lines the diff does not show open the page at
the file, as a link to the file does, and the reader scrolling, typing or clicking before the diff arrives, or during the
reveal, leaves the page where they put it.

Comments on a file: besides a line comment (the gutter's "+" or selected lines), every file's header, a diff's or one
without lines, has GitHub's "Comment on this file" (a comment icon between Viewed and the ⋯), which opens the line
comment's composer (`InlineComposer`: Cancel, "Add to review", "Comment now", no suggestion, no lines highlighted) at the
top of the file, expanding a collapsed file and going back to the file's top from a header stuck further down; pressed
again it keeps what was typed. A diff shows it, and the file's threads and batched comments on the whole file, as
file-level notes above the first hunk (`lineNumber: 0`, where outdated threads sit, on a side the diff has: `fileNotes`
in `src/pr/diff.ts`); a file without lines shows them under its header. Such a comment is a draft with `subjectType:
'file'` and no line (`ReviewThreadDraft`), which `pr.addThread` and `pr.review` send as GitHub's file comment (the file and
the comparison only); GitHub lists its thread under its file's `FILE` marker, read as a thread with no line that is not
outdated (`reviewThreads` in `src/lib/github-web/threads.ts`).

Unchanged lines: between a diff's hunks, above the first and below the last, the library's separators ("29 unmodified
lines") expand the unchanged lines the diff leaves out, as GitHub's and Graphite's do: 20 lines a click up or down, a gap
of 20 or fewer at once, or all of it (`expansionLineCount` in `FileCard`). `@pierre/diffs` expands lines only once it has
the whole file on both sides (`loadDiffFiles`), so a file's first expand asks GitHub for every line its diff hides in one
`page_data/diff_entry_lines` request (`pr.fetchDiffLines`; the new file's ranges above, between and after the hunks,
`hiddenLines` in `src/pr/diff.ts`, the last running 10,000 lines on, since the diff does not say where the file ends, and
GitHub answers it as far as the file goes) and puts both sides together from the answer (`fileContentsFrom`; the lines
asked for come as INJECTED_CONTEXT, a `~` before their text); until then the separator below the last hunk reads "More
unchanged context may be available". The contents are a query beside the file's diff (`['pr-diff', …, path,
'contents']`, `prFileContentsQuery` in `src/pr/page-data.ts`), in this tab's memory and never on the device, and the
library keeps the lines expanded while the file shows, collapsed and opened again or in the other layout. An expanded
line looks like any unchanged line, numbered on both sides, and takes no comment (`takesComments`): it has no "+", and a
selection that reaches it opens no composer. The ⋯'s "Show all lines" shows every unchanged line of the file at once
(`expandUnchanged`, which has the library ask GitHub for them the same way), and "Hide unchanged lines" puts the
separators back, the lines expanded by hand staying.

Lines GitHub holds back: GitHub sends no lines for a generated file (a lockfile, or one marked `linguist-generated`)
whatever its size, for one too big, and for every deleted file, which it marks too big; its own page shows them on
"Load Diff". The reader tells those (`withheld: 'held-back'`) from binary files (`'binary'`) by the diff entry's
`isBinary`, `isTooBig`, `diffLines` and line counts (`diffOf` in `src/lib/github-web/files.ts`), and keeps whether GitHub
calls the file generated (`newTreeEntry.isGenerated`), which the file's header tags "Generated". A held-back file's card
loads its lines by itself once it comes within a screen of the viewport (an `IntersectionObserver` with `root:
document`, as the inbox's rows), a collapsed (viewed) one only once expanded: one `page_data/diff_entry_lines` request
without ranges, as GitHub's "Load Diff" sends it (`pr.fetchDiffLines` with no ranges), made into the file's patch
(`patchOf`) and kept beside its diff (`['pr-diff', …, path, 'held-back']`, `prHeldBackDiffQuery` in
`src/pr/page-data.ts`), in this tab's memory and never on the device. Until then the card shows the skeleton, and a failure
shows in the card with a Retry. A card holds the room its lines will take (a line's height each, at least) until they are
drawn, so the files below stay where they will be and are near only once the reader is. As GitHub's page does, a deleted
file reads "This file was deleted." with a quiet "Load diff", which loads it the same way, only when clicked; a file renamed
without changes reads "File renamed without changes." and asks nothing; a binary file reads "Binary file not shown"; and
a file with no lines at all, "No lines changed". Each keeps the header a diff has: the path (the old one → the new for a
rename), after it Graphite's pill for a created, deleted or renamed file (Created, Deleted, Renamed; a modified file has
none), "Generated" and the file's language, muted (by its extension, the common ones only: `LANGUAGES` in
`src/pr/Files.tsx`), the line counts, Viewed, "Comment on this file" and the ⋯ menu.

Long diffs: a diff whose hunks have more than 1,000 rows (in the unified layout, whichever shows; `VIRTUALIZED_FROM_ROWS`
in `src/pr/Files.tsx`) draws only the rows near the viewport, with `@pierre/diffs`' own virtualization. `FilesSection`
holds one `Virtualizer` set up on the document, the page's own scroll (the library's React `<Virtualizer>` would make a
scroll container of its own), and gives it to such a card's `FileDiff` through `VirtualizerContext`, which makes the
library draw a `VirtualizedFileDiff`: the header and some 150–200 rows around the viewport, in blocks of 50, the rest
held as room of its estimated height (20 px a row, as `--diffs-line-height`), corrected as rows are drawn and measured.
Shorter diffs draw whole, as before: the library would draw nearly as many rows anyway, and a whole diff keeps the
browser's find. Sticky headers, notes, the composer, expanding lines, Viewed and the ⋯ menu work the same; a thread's
note has a box only while its line is drawn, so revealing one (n / p, a comment link, the comments drawer) moves the page
toward its line (`scrollTowardLine`, by the line numbers drawn, a card marked `data-virtualized`) until it is drawn, then
centres it. Highlighting still tokenizes the whole file on the page's thread, one long task (about 0.15–0.3 s for 4,002
lines); the library's worker pool would take it off.

Viewed files: marking a file viewed (its checkbox, or v on the current file) collapses it to its header and, as GitHub's
and Graphite's pages do, leaves the header where the reader sees it (`keepHeaderInPlace` in `src/pr/Files.tsx`): under the
toolbar, where it stuck, when the reader was inside the file, so the next file follows right below it; where it was when
it showed lower down; as near as the page scrolls at its end. Any collapse does the same (the chevron, e), and expanding a
file keeps its header where it is. The card is measured before the change and the page scrolled once the change is drawn
(a layout effect, after the diffs' own) and before it is painted, so nothing moves on the way. Collapse all and Expand
all keep the header of the file the reader is in (`fileScrolledTo`) wherever the files above it go. A file out of sight
changes nothing here: the browser's scroll anchoring keeps what the reader sees. Marking the current file viewed makes
the next one current (`moveOnFrom`), so v goes on with it, and scrolling while the viewed file's header is still at the
top leaves it so until the reader scrolls into another file.

Stacks: GitHub-native `stack` from the PR page's embedded data first; otherwise Graphite's stack
comment in the timeline, enriched through a `/pulls/search` query on the author's open PRs. The stack card
(`src/pr/StackCard.tsx`) shows each entry as Graphite does: its dot on the rail, its author's avatar, number and title,
then its conversations, Graphite's one pill for where it stands, and its age. The pill is the first that applies, in the
order the sidebar's next step goes by (`stackRowPillFor` in `src/pr/next-action.ts`): Merged, Closed, Draft, "Ready to
merge as stack", Merge conflicts, Unresolved comments, Required checks failed, Changes requested, Needs reviewers, CI
running, Behind base, Blocked, Waiting on hooks, Ready to merge; its reason is on hover. A PR nobody has approved reads
Needs reviewers, and the sidebar's next step Needs more reviewers, whatever GitHub says of merging it (GitHub says
mergeable to a viewer who may bypass the review rule); the rows read "Ready to merge as stack" and "Ready to merge" only
while the page's next step is to merge the stack. The header's Copy stack puts the
stack on the clipboard as Markdown, as Graphite's comment lists it: a line for each PR from the top, and trunk last.
Forks come from Graphite's comment alone (GitHub's own stack is one line): it lists one line of the stack, the PR's own,
and names in an entry's item the PRs that branch off it past the line, "1 other dependent PR (#9003)"
(`graphiteStackComment`), which become `Stack.forks`, each with the entry it branches from (`StackEntry.parentNumber`),
beside the line's `Stack.entries`. On a lower PR the comment lists the line only up to the one PR directly above it and
names that PR's dependents by number, nothing above them (core#10166 lists four PRs of a nine-PR stack), so when it names
PRs off the line's top, `resolveStack` continues the line upward (`lineContinuedAbove`): each of the author's open PRs
the comment does not place (those dependents among them) is asked for its `page_data/header`, the same request that names
an entry's author, now also read for its branches as `branchesIn` reads them, three at a time; a PR whose base branch is
another's head branch in the repository sits on it, and from the line's top the line goes on through the child with the
tallest chain above it (the lowest number on a tie) until none is left, every other child along the way becoming a fork
off its parent. On core#10166, with the author's 15 open PRs in the repository, that is 13 headers (all but #10166 and
#10167), before the 25-entry window centred on the viewed PR is cut. A top PR's comment names nothing off its top and asks
for nothing more. A named dependent outside the author's open PRs (closed, or another author's) stays the fork the comment
names, a header GitHub does not answer leaves its PR out (with none answered the stack is the comment's alone), and PRs
above by another author beyond what the comment names are not found, as the search lists only the author's. The card
draws a fork as Graphite does, indented right above the entry it branches from, its dot on a short rail in the rail's own colour that curves out of the main one; the header's count, the
sidebar's "Waiting on downstack" and Copy stack are the line's alone, the forks left out. The header's ⋯ is Graphite's
(`StackMenu` in `src/pr/StackMenu.tsx`): View settings opens the options page, and Show merged PRs and Show closed PRs
(`stackShowMerged` and `stackShowClosed` in settings, both on unless switched off) leave the stack's PRs in that state,
on the line or off it, out of the rows, but never the viewed PR (`stackRowsFor` in `src/pr/next-action.ts`); a fork whose
parent is left out stays above the next row below it, and the header's count and Copy stack still count the whole line.
The viewed PR's review verdict, checks and merge status come with its page;
every other entry's are the row details the inbox shows for a PR (`useRowEnrichment` in `src/inbox/row-details.ts`,
`inbox.enrich`, below), asked for while the card is open, 10 entries a request and one request at a time, under the
inbox's own key for a PR the inbox showed (its row, so either page finds what the other asked for) and the entry's own
otherwise; an entry the pointer rests on loads its page ahead, as an inbox row does (below). The stack's listing names
no verdict, checks or mergeability, so they are what the inbox's row would show:
until an entry's details arrive (and when the cache has none) its statuses are small skeletons, an open entry's checks
and merge status too while a merged or closed one says so at once; a request GitHub does not answer leaves them empty. Neither GitHub's stack (`stack.pulls[]`) nor Graphite's comment names who
opened an entry, and the search finds only the viewed PR's author's, so each other entry's author is its own
`page_data/header`'s `pullRequest.author` (`authorIn` in `src/lib/github-web/stack.ts`), asked alongside its threads. Until the stack arrives its skeleton has a round placeholder there; an
entry whose header GitHub did not answer leaves the place empty (`StackEntry.author` is null), never the viewed PR's
author. An entry Graphite's comment names by its number alone, as it links a fork, takes its title and state from that
same header (`pullRequest.title` and `state`, `withConversationsAndAuthors`); one the comment named with a title and an
icon keeps them.

Merging a GitHub-native stack: GitHub merges the viewed PR and every open PR below it in one request, `enqueue_stack`
from the viewed PR, as its own "Squash and merge stack" does (`pr.merge` sends it for any PR of a native stack). Each
open entry from the bottom up to the viewed PR carries GitHub's verdict from its own `stack_mergeability`
(`StackEntry.readyToMergeAsStack`: READY only, a status GitHub adds later is not). When every one is READY, the sidebar's next step
is Graphite's "Ready to merge as stack" in place of "Waiting on downstack", once nothing of the viewed PR's own stands in
the way (`stackToMerge` and `nextActionFor` in `src/pr/next-action.ts`); the stack card's row for the viewed PR reads
"Ready to merge as stack" and those below it "Ready to merge". Its "Merge N PRs", in the top bar too while the viewer
may merge (the bar's one primary button, green, on the viewer's own PR; on another's, where Finish review is that button,
the first item of its ⋯), and `m` open Graphite's dialog (`MergeStackDialog` in
`src/pr/MergeStackDialog.tsx`): "Merge stack of N PRs into <trunk>", a sentence true of GitHub's merge (one request, from
the PR closest to trunk up to this one), the merge strategy (the sidebar's pick, else the remembered method; its ⓘ says
what GitHub's merge box says that way does to a stack), the PRs this one first, Graphite's two options, and "<method> N
PRs" (⌘↵). Esc and ✕ close it, the focus goes round inside it and back to its opener. GitHub's own stack merge edits a
commit only for a merge commit, this PR's, so only then does this PR's row offer "Commit details": GitHub's proposal
(`pr.proposedMergeCommit`, its merge box for that method), which `pr.merge` sends as written. A stack only Graphite's
comment lists still merges a PR at a time, with the sidebar's inline confirm.

Graphite's "Ignore optional CI status checks during merge process" and "Always rebase branches before merge" are its own
engine's; GitHub's stack merge has neither (its rebase is a request of its own, and it waits for nothing short of
auto-merge), so CarbonLayer does them itself: the dialog's button starts a stack merge in the background service worker
(`src/lib/stack-merges.ts`, run by `entrypoints/background.ts`), shows a toast and closes, and the merge carries on when
the PR's tab closes. A stack merge is kept in `storage.local` (`stackMerges`, read by its schema; what another build wrote
is forgotten, saying what differs), so a restarted worker or browser carries on with it, and is moved a step on at once
and then every 30 s by an alarm (`alarms` permission; set again at browser start), a step at a time
(`advanceStackMerge`): it looks at the stack (`pr.fetchStackReadiness`: the PR page's own header, checks and merge box
stages, GitHub's dynamic workflow runs included, and each PR's `stack_mergeability`), rebases it first with GitHub's
Rebase stack when "Always rebase" is ticked and the merge box says the stack is out of date or must be rebased
(`pr.rebaseStack`, then `pr.followStackRebase` while GitHub is still at it), waits (`whatTheStackWaitsFor`) until every
required check of every PR it merges has passed (and, with "Ignore optional CI" unticked, every other check has finished
successfully: success, neutral or skipped) and GitHub says each can merge with those below it (READY, its requirements
MERGEABLE), then sends `pr.merge` from this PR with the dialog's method and commit, and follows it until the PR's header
says MERGED. A failing required check (an optional one too when unticked), a PR merged or closed meanwhile or pushed to
since the merge started (each PR's head as it first saw it, and again after its own rebase), conflicts, a stack GitHub
says must be rebased when "Always rebase" is unticked, a rebase or merge GitHub refused (in its words), six hours of
waiting, or ten minutes without GitHub merging what it was asked to, stop it, saying why. A step that could not reach
GitHub stays where it was, saying why, and is tried again; a write whose tab went away before answering is followed by
GitHub's state rather than sent again. Each step asks GitHub through a github.com tab's content script
(`browser.tabs.sendMessage` with an RPC request, which the content script reads and answers as it does the frame's):
the tab that answered last, else one showing the PR, else any; the content script writes only to a PR whose page it has
loaded, so a step that writes loads its header first. With no tab to ask, the worker opens the PR's own GitHub page
(`?gh=1`) in a tab in the background (never in front), uses it for the rest of the merge, and closes it once the merge
ends, unless the viewer is looking at it; which tab it opened lives in `storage.session`. While a merge from the dialog
covers a PR, its page shows it where the next step would be ("Rebasing stack…", "Waiting for checks · 3 of 5 required
passed", "Waiting for GitHub · #41", "Merging…"), with Cancel, which forgets it (nothing done on GitHub is undone); a
merge that stopped says why, with Dismiss. Once it has rebased, the page loads again what a rebase changes; once merged,
what a merge changes, with a toast "Merged N PRs"; the merge is then forgotten. Starting a merge of PRs another merge
under way has asks first ("Start over"), and replaces it. The fixtures' data source stands in for the worker with a
merge that merges a moment later (one merging when ready waits until it is dropped). "Merge when ready" on a PR of a
native stack turns auto-merge on the way GitHub's stack does, `enqueue_stack` with `AUTO_MERGE` (`pr.setAutoMerge`), for
it and the open PRs below it that are not queued, and while it is on the status card says so in GitHub's words; it goes
off with `disable_auto_merge`, as for a PR alone. While it is on, the stack card's row for each PR it covers reads
Graphite's "will merge when ready" after its age: the PRs the viewed PR's merge box marks (each STACK entry's
`pull.isInAutoMergeRange`, `autoMergeRange` in `mergeState`), which the page puts on the stack's entries
(`StackEntry.willMergeWhenReady`), so they follow the switch as the merge box reloads.

Where GitHub refuses its stack auto-merge to the repository, in its words "Stack auto-merge is not enabled." (matched
whatever the case; any other refusal is a toast, as ever), CarbonLayer merges the stack when it is ready itself
(`mergeStackWhenReady` in `src/lib/stack-merges.ts`): a stack merge as above of the open PRs from the bottom through this
one, from this one, marked `whenReady`, which the same background runner moves on by other rules. It goes by GitHub's own
merge rules and has no time cap, and it also waits for every optional check to finish (one that fails does not hold it, as
on GitHub; a stack's optional CodeQL run had still been going when one merged). On a head new since it last looked (a
push, or its own rebase) it waits, too, for the checks the head before had to show up, since a pipeline GitHub starts
through a webhook reports a moment later: for 10 minutes at most, as a workflow that skips the new head never does
(`headChecks` on the merge, `notStarted` in `whatTheStackWaitsFor`). A PR alone keeps GitHub's auto-merge, which waits for
required checks only. It waits through failing checks, missing reviews
and new commits (it merges the heads it saw last, and a merge `pr.merge` refuses because the PR was pushed to since sends
it back to looking), and PRs merged meanwhile are left out. It rebases the stack itself, with GitHub's Rebase stack as
above: at once when GitHub says it must be rebased, as it could never merge otherwise, and, when it is only behind its
base, last, once every required check of the PRs still open has passed and GitHub says each can merge with those below
it, so the checks run once more on what merges rather than each time the base moves while it waits. Then it waits again
for the new heads (rebasing again if the base moved meanwhile), and once nothing stands in the way it sends `pr.merge`
with the switch's method and the commit GitHub proposes then, and follows it as above. Only a closed PR, conflicts (in
GitHub's words), and a rebase or merge GitHub refused or stopped (in its words, a rebase stopped on conflicts among them)
stop it. Since it may wait for days, it looks at the stack again after a quarter of the time the stack has waited for the
same thing at the same heads, from every 30 s (checks that just started) up to every 5 minutes (a review that comes after
a day merges within 5 minutes), and a tab the worker opens to ask GitHub closes after each look, so an idle stack keeps
none open; none comes to the front. While it is under way the switch is on, with "CarbonLayer will rebase and merge this
stack when it's ready: GitHub's stack auto-merge isn't available for this repository." under it in place of GitHub's
sentence (led by "Rebasing the stack…" while it rebases and "Merging…" while it merges), the rows of the open PRs it merges
read "will merge when ready", and the next step shows as ever; the page of every PR it merges shows the same, read from
`storage.local`. The switch turned off cancels it (nothing on GitHub to undo), another method merges the same PRs with it,
and once it stopped the switch is off and the status card says why, with Dismiss. A PR alone, and a stack only Graphite's
comment lists, keep GitHub's `enable_auto_merge`.

A native stack's branches: GitHub's merge box shows one section about them, the first that applies (module `MDN` in its
bundle), which the merge box stage reads (`stackSection` in `mergeState`, `src/lib/github-web/merge-box.ts`, from the
STACK condition's entries and `pullRequest.anyStackBranchOutdated`): this PR's conflicts, conflicts in the stack up to it,
a branch up to it that must be rebased, or a stack behind its base branch. The first three keep it from merging, so they
are the sidebar's next step, in GitHub's words, before "Waiting on downstack" (`nextActionFor`), and "Merge when ready"
cannot be turned on meanwhile ("Merging is blocked due to failing stack merge requirements", as GitHub's button says); an
out-of-date stack merges all the same, so it is a card of its own above the next step, "This stack is out-of-date with
its base branch". Where GitHub offers "Rebase stack" (a rebase needed or the stack out of date, to a viewer who may push
to the base branch), so does the card: it asks first in the words of GitHub's dialog, then `pr.rebaseStack` sends
GitHub's `stack_rebase` with the head of each branch not merged yet as the merge box lists them, asks
`stack_rebase_status` until GitHub says it is done (45 s at most; GitHub carries on), says a stop on conflicts or an
error in GitHub's words, and the page reloads what a force-push changes.

## Keyboard

The PR page's bindings are one table (`PR_KEYBINDINGS` in `src/pr/keybindings.ts`) that its `?` help and the legend at
the foot of the page render; the inbox's keys are in `InboxPage`, listed by its own `?` help. None acts in a text field.
A key typed on GitHub's page while the frame lacks focus reaches the app as `gg:keydown` and is replayed on its document.

Both pages have Linear's copy shortcuts (`src/app/copy-pull-request.ts`), Ctrl for ⌘ off macOS, each confirmed in a
toast: ⌘. copies the PR's number (`#9003`, which GitHub links within the repository), ⌘C its title as a link (an anchor
as `text/html` for Slack, Linear or Docs, `[title](url)` as `text/plain`) and ⌘, its URL. The PR page copies its PR, the
inbox the row under the pointer, else the row j / k selected, else nothing. ⌘C stays the browser's copy while text is
selected, in a diff's shadow root too (the document's selection reads as collapsed there, but its type is `Range`). Only
the focused document may write to the clipboard, so for a copy key typed on GitHub's page the content script focuses the
frame before forwarding it, and keeps it from GitHub and Chrome; ⌘C with text selected on GitHub's page stays GitHub's.
The legend has no room for them; Linear's ⌘⇧, for the URL is not bound.

## Organizations (inbox)

The inbox shows one organization's pull requests at a time (`currentOrg` in settings: an organization the viewer belongs
to, or their own account). The list comes from the `orgs.list` RPC, which the content script answers with
`listOrganizations` (`src/lib/github-web/organizations.ts`): the distinct owners of the repositories GitHub's repository
picker offers for `contributed-by:@me`, with the organizations `GET /settings/organizations` lists (its rows'
`/orgs/<login>`, `/organizations/<login>/…` or `/<login>` links; HTML, signed in; when it fails or names nobody, the
owners stand alone), by login, then the viewer's own account
(`meta[name="user-login"]`, of the settings page or of the github.com page the script runs in), last; kept 10 minutes
by the page's cache.
The options page, no github.com page, asks github.com for both itself. Until an organization is chosen, or once the list
no longer has the chosen one, the inbox shows a centred "Choose an organization" card (`OrgChooser` in
`src/inbox/OrgPicker.tsx`) and fetches nothing; after that, a chip with the organization's avatar beside the repository
chip switches it (`OrgPicker`), the sections sidebar is headed by it, and the options page shows the same selector at
the top of its Inbox section and edits that organization's repositories and views. Each organization has its own views
(their order, collapsed state, filters) and repositories; one nobody has changed has Graphite's default views.

The inbox scope, prepended to every search, is compiled from the organization in `getSettings` (`organizationScope` in
`src/lib/views.ts`): the repositories chosen for it as one `(repo:a OR repo:b)`, else `org:<login>`, or `user:<login>`
for the viewer's own account. `inbox.fetch` reads it from settings as before. Each section is a query of its own,
keyed by the organization, the scope and what the view searches (so a rename or a fold asks nothing): the inbox shows
what the cache had for the organization at once, never another organization's, then asks `inbox.fetch` for the open
sections together, and for the folded ones, which show only a count until opened, once those have answered, so what is
on screen is never queued behind them. It asks again every 2 minutes while the tab shows, on coming back to it once a
section is 30 s old, and on Refresh (r); a section whose search changed (the repositories chosen, its query or limit)
shows its last answer until the new one comes. A section GitHub would not search (`/pulls/search`
answers such a search with a 200, no rows and why in `error`) or whose request failed comes back with that reason and
what GitHub was asked (`ViewResult.error`), which it shows in place of its rows and count, while the other sections load
as ever; only signed out does the whole page fail, with one banner. A page "Load more" cannot get says why in a toast and
stays offered, rather than ending the list. The harness answers a search whose parentheses do not pair up as GitHub does. The repository picker lists only the
organization's repositories (`repos.search` with an `owner`: GitHub's picker is asked `contributed-by:@me org:<login>
<text>`, and, should that bring none of the owner's, again without the qualifier, keeping the owner's;
`pickableRepositories` in `src/lib/github-web/repositories.ts`), and `setSettings` keeps only repositories the
organization owns.

## Views (inbox)

```ts
type View = { id: string; name: string; query: string; filter?: GraphiteFilter; repos?: RepoRef[]; limit?: number; collapsed?: boolean }
```

(`viewSchema` in `src/lib/model.ts`; the filter is `graphiteFilterSchema` in `src/lib/graphite.ts`.)

Stored in `chrome.storage.sync`, which holds at most 8 KB an item and 100 KB in all: each view is an item of its own,
`view:<org>/<id>`, and the `settings` item holds the rest: `currentOrg`, each organization's views' order
(`viewsByOrg: { [login]: { viewOrder } }`) and repositories (`reposByOrg`); a save writes only the views that changed,
and a write Chrome refuses reaches the UI as an error (`src/lib/settings.ts`). Views saved before views belonged to an
organization (`view:<id>` items in `viewOrder`, with `inboxRepos` / `inboxScope`) stay until the first organization is
chosen: the chooser offers "Keep my current views for this organization" (on by default), which moves them, and their
repositories that organization owns, to it; otherwise it starts from the defaults. Either way the old items go. What is
stored is read by schemas: a view item of another shape is left out (the others keep their order), and every field of the
`settings` item may be missing, as an earlier version or nobody wrote it; one this version cannot read counts as unset
(a preference as its default, the chosen organization as none), and keys it does not know stay in the item when it is
written back, as another device's version may have written them (`storedSettingsSchema`). The
default views are Graphite's default sections as the Graphite import translates
them (`DEFAULT_VIEWS` in `src/lib/views.ts`: each with its Graphite `filter`, the viewer as `@me`, and the query compiled
from it); settings whose views are all an earlier version's defaults (GitHub's own inbox sections) get them once, in
`getSettings`. A query `inbox:<filter>` is one of GitHub's own inbox sections (`/pulls/inbox/queries`), anything else a
search (`/pulls/search`) with the inbox scope prepended, unless the query names repositories of its own (`repo:`), which
it then searches instead.
A view with a `filter` (Graphite's share-link form, `{ groups: [{ rules: [{ isNegated, conditions }] }] }`) is edited
row by row in the section editor (`src/inbox/SectionEditor.tsx`, a right-side drawer like Graphite's "Update section",
opened from a section's gear in the inbox and from "Edit…" on the options page), and its `query` is compiled from the
filter and its own `repos` on every save with the import's mapping (`searchForFilter` in `src/lib/graphite.ts`).
A username field there (Author, the reviewer and assignee fields, Mentions) is a combobox over the organization's people
beside its `+ @me` chip: as the user types, those whose login or name has the text are listed under it (a login that
begins with it first, then a name with a word that does), ↑ / ↓ and Enter or a click add one's login, Esc closes only the
list, and Enter with nobody reached adds the text as typed. The people come from `orgs.people`, which the content script
answers with `organizationPeople` (`src/lib/github-web/people.ts`) from the organization's People page (`GET
/orgs/<login>/people`, HTML, signed in; further pages read while one links to the next, ten at most), kept 10 minutes
by the page's cache;
the options page asks github.com itself, and the viewer's own account has nobody.
"Advanced" there shows that query and lets the user write one by hand instead, which drops the filter. Beside the
section cards, Graphite's sections sidebar (`src/inbox/SectionsSidebar.tsx`) lists every section with its count, the one
in view highlighted; a click scrolls to the section (expanding it), ↑ / ↓ reorder, the gear opens the editor and "Add
section" opens it for a new view. Its heading links to the organization on GitHub, and below "Add section" it lists the
organization's repositories, each a link to it there: the ones chosen in the repository picker when the inbox searches
only those, else the viewer's top repositories as GitHub's homepage lists them, narrowed to the organization
(`repos.top`: `topRepositories` in `src/lib/github-web/repositories.ts` reads the HTML fragments GitHub's dashboard
loads, which span every owner, so `useTopRepositories` reads further pages until seven of the organization's show, the
pages kept 10 minutes; "Show more" asks for seven more the same way). It hides with `sidebarCollapsed` in settings, and below 900px it opens over the inbox
from the top bar's toggle.

Rows follow Graphite's columns (`src/inbox/InboxSection.tsx`): unread dot, avatar, title with `author · owner/repo #N`,
stacked reviewer avatars (three, then `+N`; a bot without an avatar gets its GitHub App's, else a bot glyph; the tooltip
names each reviewer with their state, "jlord · approved"), a labels chip, Graphite's conversation counter (an icon and review threads
resolved of all, "2/3", without a chip's border, hidden without any and once every one is resolved; the PR page's stack card shows it on each entry, "3/3" too), the stack chip (its tooltip Graphite's "2/2 position in stack"; GitHub's
own stack's position, grey; else, as Graphite's inbox shows it, the place Graphite's stack comment on the PR's page gives
it on the PR's own line, merged and closed entries too, forks left out ("6/6" on offstreetparking/core#9029, whose #9003
branches off #8994), grey as well, for open, merged and closed rows alike (`inbox.graphiteStacks`:
the page's HTML read by `graphiteStackComment` and `graphiteStackPlace` in `src/lib/github-web/stack.ts`, three PRs at a
time, asked as a row not in GitHub's own stack comes within 200px of view, or, grouped by stack, for every open row as
soon as it is known, the sections higher up first, 10 rows a request and one request at a time, and again only once the
row has been updated since; `useGraphiteStacks` in `src/inbox/InboxPage.tsx`); else, for a stack
GitHub doesn't track, found from branch names as "Group by stack" finds it, the
row's place counted up from the bottom-most PR the inbox knows, of its own line (a fork's other branches left out), amber, its tooltip saying GitHub doesn't track the stack, grouped or not; `stackPlaces` in
`src/inbox/stacks.ts`), then
fixed Review, CI and Merge icon columns, line counts and age, under a header row whose Title, Changes and Updated sort
the section (page state only); Changes and Updated keep 16px from their neighbours. An empty section shows only its header,
its count `0`, as Graphite's does. Every icon says what it means on
hover. Each status column is one function from the row's data to an icon, a tone and a tooltip (`reviewStatusIcon`,
`ciStatusIcon`, `mergeStatusIcon` in `src/ui/status-icons.ts`, drawn by `StatusIcon`), tested case by case:

| column | icon · tone · tooltip | when |
| --- | --- | --- |
| Review | pencil · grey · "Draft" | a draft |
| | pencil · orange · "Changes requested by …" | any reviewer requested changes |
| | filled check · green · "Approved by you" | the viewer approved |
| | person-check · green · "Approved by others" (+ "; waiting for …") | others approved (requests still open) |
| | clock · orange · "Waiting for …" | requests nobody has answered |
| | dash · grey · "No opinionated reviews" | no reviewers, or comments only |
| | skeleton; then the dashboard's decision (approved, changes requested, waiting, "No opinionated reviews") | until the row's details arrive (not for a draft); then if they name no reviewers |
| CI | filled check · green · "All CI passing" | every check passed (cancelled ones, like skipped ones, do not count as failing) |
| | outline check · yellow · "Non-required CI failing: …" | only optional checks fail |
| | filled x · red · "Required CI failing: …" / "CI failing (n of m)…" | a required check fails / any failure, until GitHub says which are required |
| | clock · grey · "CI running (n/m)" | checks still running |
| | skeleton; dash · grey · "No checks" / "No verdict from the checks" | an open row until its details arrive; no checks / only cancelled or skipped ones |
| Merge | filled check · green · "Mergeable" | CLEAN, HAS_HOOKS |
| | merge · purple · "Merged" / closed glyph · red · "Closed" | merged / closed |
| | filled x · red · "Merge conflict" | DIRTY |
| | filled check · green · "Mergeable; blocked on GitHub: <the merge box's reason>" | BLOCKED, BEHIND, UNSTABLE |
| | merge · blue · "Queued in the merge queue" / "Auto-merge …" | queued or set to auto-merge |
| | skeleton; dash · grey · "Unknown" | an open row until its details arrive; DRAFT, UNKNOWN |

GitHub's dashboard rows carry review decision and CI rollup but no mergeability, reviewers or line counts: as a row comes
within 200px of view (an `IntersectionObserver` per row, rooted at the page's own document), the inbox asks
`inbox.enrich` for it (`useRowEnrichment` in `src/inbox/row-details.ts`, shared with the PR page's stack card), up to 10 rows a request and one request at a time, and the content script answers from each PR's
`page_data/merge_box` (mergeability and the first unmet requirement as the reason it is blocked; skipped for drafts and
merged or closed PRs), `page_data/review_requests` (reviewers, bots and teams included, and the viewer's own review,
by the page's `meta[name="user-login"]`; else the reviewers the merge box names; the verdict they make as the PR page
words it, `reviewDecisionOf`), `page_data/diffstat`,
`page_data/threads` (its conversations, `conversationsIn` in `src/lib/github-web/threads.ts`) and, for an open PR,
`page_data/status_checks` (which checks fail and which are required, `checksFrom` in
`src/lib/github-web/checks.ts`) with GitHub's own dynamic workflow runs on the head commit (above), three PRs at a time
(`enrichPull` in `src/lib/github-web/inbox.ts`). A row is asked again when it was updated, its rollup changed or the merge
method did, and its answer is kept 2 minutes; the checks it found are its CI. Until a row's first answer arrives its
Reviewers and Changes columns show a skeleton dash, an open row's CI column a placeholder and its Merge column
"Unknown"; after that it shows what was last found (the cache's too) until the new answer, which keeps what it misses
from the last; a failure leaves the row as it was.

"Group by stack", a switch beside the top bar's repository chip (`inboxGroupByStack` in settings), shows each stack's rows
together (`rowsByStack` in `src/inbox/stacks.ts`): a PR whose base branch is another row's head branch in the same
repository (in any section) sits on it, and a section shows the stack where the first of its rows sorts, its top first
and the rest indented under it, top down. The branches come from each open PR's page header (`inbox.branches`:
`page_data/header`'s `baseBranch` and `headBranch`, a fork's head branch left out, `branchesIn` in
`src/lib/github-web/inbox.ts`; six PRs at a time), looked up first: while the switch is on, the inbox asks about every
open row the cache has nothing for, 25 a request and up to three requests at once, the rows of the sections higher up
first. A PR's branches do not change, so once named they are kept until the cache lets them go after a day; a row GitHub
named none for is asked again on the next page load. A row's merge box, once enriched, has the last word. (The
`stackBranches` entry in `storage.local` that kept them before is removed.) Until each of its open rows is answered,
its branches, its Graphite place (below) and, when it is in a stack, its stack (or 15 s after its rows were first asked
about, since places and stacks are asked one after the other), a section shows skeleton rows, so it appears already
grouped with its context rows (at once when every answer is remembered), each section on its own (one gate, one timer,
in `useStackBranches`); once shown it stays so, and rows that come later ("Load more", a refresh), or answers that come
after the 15 s, join their stacks as they arrive.

Grouped by stack, the inbox asks up front, as soon as an open row is known and whether or not it shows, for its
Graphite place (the chip's, above; the sections higher up first) and then, for each open row that is in a stack (one
of GitHub's own, or one Graphite's stack comment places it in among two or more), for its stack through the PR page's
own stack stage (`prStageQuery(…, 'stack')`, `useInboxStacks` in `src/inbox/InboxPage.tsx`), under the page's key, so
the PR page opens with that stack cached and a stack a PR page fetched shows here at once. The stage costs the PR's page
and, for Graphite's stack, a search and a header and threads request for each entry, so it is asked sparingly: not for
a row a stack known for a row before it already lists (matched by number and repository, its name in any case,
`isSamePr`), three rows at a time, the next row no answered stack lists following as each answers, so that a stack's
other rows mostly find its answer first, kept 2 minutes, and not asked again on coming back to the tab. Merged and
closed rows bring no stack along: none is asked for them, a section waits for none of theirs, and they stand alone with
their chip, whose place is asked as they show. Only an answer whose line lists its own row counts, and only the line:
the forks stay out, as the inbox's stack chip leaves them out. An open row a known stack lists brings its whole line
along (`rowsWithStacks` in
`src/inbox/stacks.ts`): the group sits where its first row sorts, top first, and the stack's PRs the section does not
list show among its rows as context rows (`ContextRow` in `src/inbox/ContextRow.tsx`, `gg-row--context`), always
drawn: one condensed line each, about two thirds of a row's height, in the rows' grid so its left edge and the rail line
up with theirs, showing only what the stack already says: the PR's state icon (open, draft, merged or closed, in the
colours the PR page's state pill gives them) where a row's avatar is, then its chip, its place in the stack's line ("3/4
position in stack"), its title and its byline (its author where the stack names one, the repository and number), all
smaller and muted, the row's own hover and selection as any row's. It has no reviewer, CI, merge, changes or updated
columns, so it asks for no details: a context row is the stack's entry, or the row another section shows for the PR
where there is one, as they are. This way a section's PR whose stack Graphite restacked after merges, which branch names
no longer chain, still shows the whole stack under it. A merged or closed context row follows the stack card's
`stackShowMerged` / `stackShowClosed` (its ⋯ menu), while a row the section lists always shows. Every row but the first
of its group hangs from the rail under the row above (`stacked` from `rowsWithStacks`), a context row too. Its PR page is
loaded ahead once the pointer has rested on it or it is selected, as for any row. The section's count stays its own,
"Load more" goes on from its own rows, and j / k, the copy keys and a click reach a context row as any row. A row no
known stack lists, and a merged or closed row even when one does, is grouped by its branches as above (merged and
closed rows have none looked up, so they stand alone), while a merged PR an open row's stack lists still shows as a
context row under that row in the open row's section.

Section counts read `sectionCount` (`99+` above 99, `<limit>+` for a view cut short below that). A section shows
GitHub's first page of rows (cut to the view's `limit`, default 50); while GitHub counts more, "Load more" at its foot
asks `inbox.fetchMore` for the next of GitHub's pages (`/pulls/search?…&page=N` with its `/pulls/deferred`, or
`/pulls/inbox/queries?…&page=N`, a query each, kept 30 s) and appends the rows (page state, kept while the view's search
is unchanged), until a page comes back empty.

Repositories are picked, not typed (`src/inbox/RepoPicker.tsx`): the inbox's top-bar chip, the options page and the
section editor's Repositories field open a popover with a search box, "Select all / none" and checkboxes, fed by GitHub's
own repository picker, narrowed to the organization shown (above; the options page, no github.com page, asks github.com
directly under the extension's host permission). The inbox's choice is the organization's `inboxRepos`, compiled into
the `inboxScope` that is prepended; a scope saved before organizations as bare `repo:` terms reads back as those
repositories chosen. Sharing: "Share" encodes
the view list into `https://github.com/#views=<base64url json>`; opening such a link with the
extension installed offers to import (replace or append; appending a view named like one already there, case aside,
replaces that one in place under its id).

Importing from Graphite (`src/lib/graphite.ts`, UI in `src/inbox/GraphiteImport.tsx` on the inbox's "Import from
Graphite…" dialog and the options page): "Copy my sections from Graphite" reads every section straight out of the
signed-in Graphite inbox (flow above), and pasted `?new-section=` / `?shared-sections=` links or their JSON work too.
What they hold is read by schemas: a filter in the share links' form (`graphiteFilterSchema`: every rule with conditions,
all of one kind, each with the value its kind needs) or the inbox page's OR / AND / NOT tree converted to it, a list of
named sections, or the inbox page's copy; anything else is refused with what was expected.
Each section becomes one view, mapped as the "Verified mapping" in `docs/research/graphite-sections.md` says (checked
section by section against the user's live Graphite inbox): rules are ANDed, a rule's conditions ORed (`(author:a OR
author:b)`, a comma-separated `label:`), `isNegated` negates a rule, a rule only several alternatives express (Review
status "has an active review") spreads over its group, alternatives that contradict themselves go, and the viewer's own
login and `<REPLACE_USERNAME>` become `@me`. Groups and alternatives that repeat or only narrow another are dropped before
the rest are ORed as `((g1) OR (g2))` (GitHub's dashboard search accepts that; above five operators the section splits
into numbered views). A positive rule GitHub cannot search for (Merging, counts, forks, source, some review states)
drops its group, a negated one only itself, each with a note under the view. Several repositories are always one
`(repo:a OR repo:b)`: the dashboard search ANDs repeated `repo:` terms. Sections on the inbox's default repositories
carry no `repo:` terms; the dialog offers to search those repositories instead (`placeGraphiteImport` in
`src/inbox/import-views.ts`): when one of the viewer's organizations owns them all, they become its repositories and the
sections its views (the inbox switches to it); otherwise the sections join the current organization, each that searched
them carrying them as its own `repos`. Relative times
(`{{7d}}`) resolve to an ISO timestamp, not a date. See `docs/research/graphite-sections.md`.

## Verification

- `pnpm typecheck` (tsc) and `pnpm build` must pass.
- `pnpm test` (vitest) covers pure logic: the github-web mappers and session handling, stack inference,
  view link encode/decode, Graphite section import, routes, keyboard chords, next-step derivation, and what the
  extension's parts read of each other (RPC requests and answers, bridge messages, stored settings, the kept cache).
- Harness: `pnpm build`, then serve `.output/chrome-mv3` statically and open `app.html?fixtures=1#/inbox` or
  `app.html?fixtures=1#/pr/acme/widgets/42` for visual checks (no session, no `chrome.*`). Its cache stays in memory, so
  every run starts clean; `&keep=<label>` keeps it on the device as the fixtures' viewer under that label (and this
  build) instead, for checking what a second load restores (another label or build restores nothing). Moves between pages
  are checked with the real content script on stand-in github.com pages whose frame is pointed at `app.html?fixtures=1`.
  Such runs block Chromium's DNS (`--host-resolver-rules=MAP * ~NOTFOUND`) as well as routing every request to a
  stand-in or an abort: a tab the browser opens from a link (⌘-click) or the background opens (the Graphite copy) loads
  before Playwright's routing reaches it, and would otherwise go to the real site.
- Real-site check: load `.output/chrome-mv3` unpacked while signed in to github.com, open github.com.
