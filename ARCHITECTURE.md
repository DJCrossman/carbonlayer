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
| `github.content.ts` | Content script on `github.com/*`, run at `document_start`. Recognises the inbox (the homepage `/`, only when `<meta name="user-login">` names a signed-in user: signed out, `/` is GitHub's marketing page and stays untouched, so at `document_start` the script waits for that tag, or for `<body>`, before hiding anything) and PR (`/:owner/:repo/pull/:n`, plus `/files`, `/changes`, `/commits`, `/checks`) routes (`src/app/routes.ts`). On a handled route it reads the settings, then hides GitHub's `main` with a `<style>` on `<html>` before the page paints, and mounts the iframe (`app.html#<route>`) on `<html>` too, below GitHub's header, so Turbo's `<body>` swaps leave both in place and a soft navigation moves the loaded app with `gg:route` instead of reloading it. It forwards theme and keydown to the iframe, performs top-level navigations the iframe asks for (`src/app/bridge.ts`), answers the iframe's RPC requests with `handleRpc` from `src/lib/github-web/` (session fetches), and re-routes on `wxt:locationchange`. `?gh=1` leaves GitHub untouched for one visit. The `inboxEnabled` / `prEnabled` settings leave it untouched until switched back. On every handled route the script adds a "GitHub \| CarbonLayer" switch (`role="group"`, two `aria-pressed` buttons, plain DOM, GitHub's colour variables) to GitHub's header, just before the + / notifications cluster (`[data-testid="top-bar-actions"]` in the signed-in global nav, `.AppHeader-actions` on older headers; signed out, the marketing header's search-and-sign-in cluster; failing those, the header's end). It shows the surface's setting and saves it on click, and the settings watcher mounts or releases the app in place. GitHub's headers are server-rendered React partials, and a node inserted among their children before hydration makes React render the header again without it, so the switch lives in an open shadow root on that cluster beside a `<slot>` for GitHub's own children; it is placed once the header is parsed and again after a Turbo `<body>` swap or a React re-render. |
| `app/` | The React app (`entrypoints/app/main.tsx`): hash router → `InboxPage` (`src/inbox/`) or `PrPage` (`src/pr/`). Data comes through a `DataSource` (`src/app/data-source.ts`): the RPC-backed one in the extension, a fixture-backed one when opened with `?fixtures=1` (the dev harness). Listed in `web_accessible_resources` for `https://github.com/*`. |
| `background.ts` | Brokers the one-click copy from Graphite: opens `app.graphite.com` next to the inbox's tab, remembers both tabs in `storage.session`, stores the copied sections under `graphiteImport` in `storage.local`, then closes the Graphite tab and re-activates the inbox. Nothing else. |
| `graphite.content.ts` / `graphite-sections.content.ts` | On `app.graphite.com`, only in the tab the background opened: the isolated script asks the page-world script (`world: 'MAIN'`) for the inbox's sections; that one waits for the inbox to render, walks React's internal state above a sidebar item to the inbox `snapshot` (`inboxSnapshotOf` in `src/lib/graphite.ts`) and posts the sections, the inbox's repositories and the signed-in login back. A banner in the tab reports the result. |
| `options/` | Options page: inbox scope and views editor, merge method, diff layout, theme, on/off switches. |
| `popup/` | Toolbar popup: on/off toggles, links to inbox and options. |

## Data flow: the user's github.com session, no token

App (iframe) → `window.parent.postMessage` RPC (`src/lib/rpc.ts`) → content script on github.com →
`src/lib/github-web/` makes same-origin fetches against the JSON endpoints GitHub's own React UI
uses (`/pulls/inbox/queries`, `/pulls/search`, `/pulls/…/deferred`, `/{o}/{r}/pull/{n}/page_data/*`,
`/repositories/picker/search`, the pages' embedded `react-app.embeddedData`) with the session cookies → normalised domain objects
(`src/lib/model.ts`) are posted back. Writes go to the `page_data/*` routes GitHub's PR page posts
to, except re-running checks: the PR page cannot, so `github-web/actions.ts` submits the classic form GitHub's Actions
run page loads into its re-run dialog. See `docs/research/github-web-endpoints.md`, `github-web-mutations.md` and
`github-web-reviewers.md`. No api.github.com, no token. The background service worker only brokers the one-click copy from Graphite (below).

Signed-in state comes from the fetched PR page's `meta[name="user-login"]`: empty means the PR page
shows "Sign in to github.com in this tab". Signed in, the routes behind the sidebar (`merge_box`,
`status_checks`, `stack_mergeability`, `review_requests`, `labels`, `assignees`, `description`) and
the inbox's deferred fields are side details: a failure is logged with `console.debug('[gg]', …)` and
leaves that card empty. Reads are cached in the content script for 30–60 s; a successful write clears
the cache and the page refetches with `force`.

Stacks: GitHub-native `stack` from the PR page's embedded data first; otherwise Graphite's stack
comment in the timeline, enriched through a `/pulls/search` query on the author's open PRs.

## Views (inbox)

```ts
type View = { id: string; name: string; query: string; filter?: GraphiteFilter; repos?: RepoRef[]; limit?: number; collapsed?: boolean }
```

Stored in `chrome.storage.sync`, which holds at most 8 KB an item and 100 KB in all: each view is an item of its own,
`view:<id>`, and the `settings` item holds the rest with the views' order (`viewOrder`); a save writes only the views
that changed, and a write Chrome refuses reaches the UI as an error (`src/lib/settings.ts`). The default views are Graphite's default sections as the Graphite import translates
them (`DEFAULT_VIEWS` in `src/lib/views.ts`: each with its Graphite `filter`, the viewer as `@me`, and the query compiled
from it); settings whose views are all an earlier version's defaults (GitHub's own inbox sections) get them once, in
`getSettings`. A query `inbox:<filter>` is one of GitHub's own inbox sections (`/pulls/inbox/queries`), anything else a
search (`/pulls/search`) with the inbox scope prepended, unless the query names repositories of its own (`repo:`), which
it then searches instead.
A view with a `filter` (Graphite's share-link form, `{ groups: [{ rules: [{ isNegated, conditions }] }] }`) is edited
row by row in the section editor (`src/inbox/SectionEditor.tsx`, a right-side drawer like Graphite's "Update section",
opened from a section's gear in the inbox and from "Edit…" on the options page), and its `query` is compiled from the
filter and its own `repos` on every save with the import's mapping (`searchForFilter` in `src/lib/graphite.ts`).
"Advanced" there shows that query and lets the user write one by hand instead, which drops the filter. Beside the
section cards, Graphite's sections sidebar (`src/inbox/SectionsSidebar.tsx`) lists every section with its count, the one
in view highlighted; a click scrolls to the section (expanding it), ↑ / ↓ reorder, the gear opens the editor and "Add
section" opens it for a new view. It hides with `sidebarCollapsed` in settings, and below 900px it opens over the inbox
from the top bar's toggle.

Rows follow Graphite's columns (`src/inbox/InboxSection.tsx`): unread dot, avatar, title with `author · owner/repo #N`,
stacked reviewer avatars, a labels chip, the stack chip, then fixed Review, CI and Merge icon columns (`ReviewStatus`,
`CiStatus` and `MergeStatus` as `variant="icon"`), line counts and age, under a header row whose Title, Changes and
Updated sort the section (page state only). GitHub's dashboard rows carry review decision and CI rollup but no
mergeability, reviewers or line counts: as a row comes within 200px of view (an `IntersectionObserver` per row, rooted
at the page's own document), the inbox asks `inbox.enrich` for it, up to 10 rows a request and one request at a time,
and the content script answers from each PR's `page_data/merge_box` (skipped for drafts and merged or closed PRs) and
`page_data/diffstat`, three PRs at a time, each answer kept 2 minutes (`enrichPull` in `src/lib/github-web/inbox.ts`).
Until a row's answer arrives its Reviewers, Merge and Changes columns show a skeleton dash; a failure leaves the row as
it was. Section counts read `sectionCount` (`99+` above 99, `<limit>+` for a view cut short below that). A section shows
GitHub's first page of rows (cut to the view's `limit`, default 50); while GitHub counts more, "Load more" at its foot
asks `inbox.fetchMore` for the next of GitHub's pages (`/pulls/search?…&page=N` with its `/pulls/deferred`, or
`/pulls/inbox/queries?…&page=N`) and appends the rows (page state, kept while the view's search is unchanged), until a
page comes back empty.

Repositories are picked, not typed (`src/inbox/RepoPicker.tsx`): the inbox's top-bar chip, the options page and the
section editor's Repositories field open a popover with a search box, "Select all / none" and checkboxes, fed by GitHub's
own repository picker (`repos.search` RPC → `GET /repositories/picker/search?q=contributed-by:@me <text>`, read by
`src/lib/github-web/repositories.ts`; the options page, no github.com page, asks github.com directly under the
extension's host permission). The inbox's choice is stored as `inboxRepos`, and `setSettings` keeps `inboxScope` the
compiled `(repo:a OR repo:b)` that is prepended; a scope saved earlier as bare `repo:` terms reads back as those
repositories chosen. Sharing: "Share" encodes
the view list into `https://github.com/#views=<base64url json>`; opening such a link with the
extension installed offers to import (replace or append; appending a view named like one already there, case aside,
replaces that one in place under its id).

Importing from Graphite (`src/lib/graphite.ts`, UI in `src/inbox/GraphiteImport.tsx` on the inbox's "Import from
Graphite…" dialog and the options page): "Copy my sections from Graphite" reads every section straight out of the
signed-in Graphite inbox (flow above), and pasted `?new-section=` / `?shared-sections=` links or their JSON work too.
Each section becomes one view, mapped as the "Verified mapping" in `docs/research/graphite-sections.md` says (checked
section by section against the user's live Graphite inbox): rules are ANDed, a rule's conditions ORed (`(author:a OR
author:b)`, a comma-separated `label:`), `isNegated` negates a rule, a rule only several alternatives express (Review
status "has an active review") spreads over its group, alternatives that contradict themselves go, and the viewer's own
login and `<REPLACE_USERNAME>` become `@me`. Groups and alternatives that repeat or only narrow another are dropped before
the rest are ORed as `((g1) OR (g2))` (GitHub's dashboard search accepts that; above five operators the section splits
into numbered views). A positive rule GitHub cannot search for (Merging, counts, forks, source, some review states)
drops its group, a negated one only itself, each with a note under the view. Several repositories are always one
`(repo:a OR repo:b)`: the dashboard search ANDs repeated `repo:` terms. Sections on the inbox's default repositories
carry no `repo:` terms; the dialog offers to set the inbox scope to those repositories instead. Relative times
(`{{7d}}`) resolve to an ISO timestamp, not a date. See `docs/research/graphite-sections.md`.

## Verification

- `pnpm typecheck` (tsc) and `pnpm build` must pass.
- `pnpm test` (vitest) covers pure logic: the github-web mappers and session handling, stack inference,
  view link encode/decode, Graphite section import, routes, keyboard chords, next-step derivation.
- Harness: `pnpm build`, then serve `.output/chrome-mv3` statically and open `app.html?fixtures=1#/inbox` or
  `app.html?fixtures=1#/pr/acme/widgets/42` for visual checks (no session, no `chrome.*`).
- Real-site check: load `.output/chrome-mv3` unpacked while signed in to github.com, open github.com.
