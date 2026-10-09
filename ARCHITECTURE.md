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
| `options/` | Options page: inbox scope and views editor, merge method, diff layout, theme, on/off switches. |
| `popup/` | Toolbar popup: on/off toggles, links to inbox and options. |

## Data flow: the user's github.com session, no token

App (iframe) → `window.parent.postMessage` RPC (`src/lib/rpc.ts`) → content script on github.com →
`src/lib/github-web/` makes same-origin fetches against the JSON endpoints GitHub's own React UI
uses (`/pulls/inbox/queries`, `/pulls/search`, `/pulls/…/deferred`, `/{o}/{r}/pull/{n}/page_data/*`,
the pages' embedded `react-app.embeddedData`) with the session cookies → normalised domain objects
(`src/lib/model.ts`) are posted back. Writes go to the `page_data/*` routes GitHub's PR page posts
to, except re-running checks: the PR page cannot, so `github-web/actions.ts` submits the classic form GitHub's Actions
run page loads into its re-run dialog. See `docs/research/github-web-endpoints.md`, `github-web-mutations.md` and
`github-web-reviewers.md`. No api.github.com, no token, no background service worker.

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
type View = { id: string; name: string; query: string; limit?: number; collapsed?: boolean }
```

Stored in `chrome.storage.sync`. Default views mirror Graphite's sections; a query `inbox:<filter>` is one
of GitHub's own inbox sections (`/pulls/inbox/queries`), anything else a search (`/pulls/search`) with
the inbox scope prepended. Sharing: "Share" encodes
the view list into `https://github.com/#views=<base64url json>`; opening such a link with the
extension installed offers to import (replace or append).

Importing from Graphite (`src/lib/graphite.ts`, UI in `src/inbox/GraphiteImport.tsx` on the inbox's "Import from
Graphite…" dialog and the options page): Graphite's `?new-section=` (one unnamed filter) and `?shared-sections=`
(named sections with repositories) links, or the JSON they carry, become views. A rule's conditions are ORed (repeated
`author:`, comma-separated `label:`, a set of PR states), rules are ANDed, `isNegated` negates a rule, a section's
repositories become `repo:` qualifiers and `<REPLACE_USERNAME>` becomes `@me`. GitHub's search cannot OR groups, so each
group is a view of its own. What it only approximates (`reviewed-by:` for approvers, `is:open` for Merging) or cannot
express (file and line counts, forks, source, some review states) is listed as notes in the preview, per section. See
`docs/research/graphite-sections.md`.

## Verification

- `pnpm typecheck` (tsc) and `pnpm build` must pass.
- `pnpm test` (vitest) covers pure logic: the github-web mappers and session handling, stack inference,
  view link encode/decode, Graphite section import, routes, keyboard chords, next-step derivation.
- Harness: `pnpm build`, then serve `.output/chrome-mv3` statically and open `app.html?fixtures=1#/inbox` or
  `app.html?fixtures=1#/pr/acme/widgets/42` for visual checks (no session, no `chrome.*`).
- Real-site check: load `.output/chrome-mv3` unpacked while signed in to github.com, open github.com.
