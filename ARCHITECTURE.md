# Graphite-style GitHub — architecture

A Chrome (MV3) extension, built with WXT + React 19 + TypeScript, that re-renders two GitHub
surfaces in the style of Graphite:

1. **Inbox** at `https://github.com/pulls` — several configurable, shareable "views" (each view is a
   GitHub search query) rendered on one page with review / CI / merge status per PR.
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
| `background.ts` | Nothing data-related; kept minimal. |
| `github.content.ts` | Content script on `github.com/*`. Recognises the inbox (`/pulls`) and PR (`/:owner/:repo/pull/:n`) routes (`src/app/routes.ts`), hides GitHub's `main`, mounts the iframe pointing at `app.html#<route>`, forwards theme + keydown to the iframe, performs top-level navigations the iframe asks for (`src/app/bridge.ts`), answers the iframe's RPC requests with `handleRpc` from `src/lib/github-web/` (session fetches), and re-routes on `wxt:locationchange`. `?gh=1` or the popup toggle leaves GitHub untouched. |
| `app/` | The React app (`entrypoints/app/main.tsx`): hash router → `InboxPage` (`src/inbox/`) or `PrPage` (`src/pr/`). Data comes through a `DataSource` (`src/app/data-source.ts`): the RPC-backed one in the extension, a fixture-backed one when opened with `?fixtures=1` (the dev harness). Listed in `web_accessible_resources` for `https://github.com/*`. |
| `options/` | Options page: merge method, diff layout, inbox scope, views editor, keybinding reference. |
| `popup/` | Toolbar popup: on/off toggles, links to inbox and options. |

## Data flow: the user's github.com session, no token

App (iframe) → `window.parent.postMessage` RPC (`src/lib/rpc.ts`) → content script on github.com →
`src/lib/github-web/` makes same-origin fetches against the JSON endpoints GitHub's own React UI
uses (`/pulls/inbox/queries`, `/pulls/search`, `/{o}/{r}/pull/{n}/page_data/*`, the pages' embedded
`react-app.embeddedData`) with the session cookies → normalised domain objects (`src/lib/model.ts`)
are posted back. See `docs/research/github-web-endpoints.md`. No api.github.com, no PAT. The
background service worker has no data role.

Stacks: GitHub-native `stack` from the PR page's embedded data first; otherwise Graphite's stack
comment in the timeline, enriched through a `/pulls/search` query on the author's open PRs.

## Views (inbox)

```ts
type View = { id: string; name: string; query: string; limit?: number; collapsed?: boolean }
```

Stored in `chrome.storage.sync`. Default views mirror Graphite's sections. Sharing: "Copy link" encodes
the view list into `https://github.com/pulls#views=<base64url json>`; opening such a link with the
extension installed offers to import (replace or append).

## Verification

- `pnpm compile` (tsc) and `pnpm build` must pass.
- `pnpm test` (vitest) covers pure logic: stack inference, view link encode/decode, status derivation.
- Harness: `pnpm build`, then serve `.output/chrome-mv3` statically and open `app.html?fixtures=1#/inbox` or
  `app.html?fixtures=1#/pr/acme/widgets/42` for visual checks (no token, no `chrome.*`).
- Real-site check: load `.output/chrome-mv3` unpacked while signed in to github.com, open github.com/pulls.
