# Graphite-style GitHub — architecture

A Chrome (MV3) extension, built with WXT + React 19 + TypeScript, that re-renders two GitHub
surfaces in the style of Graphite:

1. **Inbox** at `https://github.com/pulls` — several configurable, shareable "views" (each view is a
   GitHub search query) rendered on one page with review / CI / merge status per PR.
2. **PR page** at `https://github.com/<owner>/<repo>/pull/<n>[/…]` — stack at the top, a single
   vertical scroll (description → activity → diff), CI / reviewers / merge status in a right sidebar,
   diffs rendered with `@pierre/diffs`, Graphite keybindings.

## Entry points (`entrypoints/`)

| file | role |
| --- | --- |
| `background.ts` | Owns the GitHub API client (GraphQL + REST), the PAT, response cache, and answers RPC messages from content scripts. |
| `inbox.content.tsx` | Content script matching `github.com/pulls*`. Hides GitHub's `main`, mounts the Inbox React app in a shadow root. |
| `pr.content.tsx` | Content script matching `github.com/*/*/pull/*`. Hides GitHub's `main`, mounts the PR React app in a shadow root. |
| `options/` | Options page: PAT, default merge method, views editor, keybinding reference. |
| `popup/` | Toolbar popup: on/off toggle for the current page, link to inbox and options. |
| `harness/` | Dev-only page that renders the Inbox and PR apps from JSON fixtures so they can be screenshotted without a token. |

Both content scripts share one mounting approach: `createShadowRootUi` with `cssInjectionMode: 'ui'`,
`inheritStyles: false`; listen to `wxt:locationchange` to re-route on GitHub's Turbo navigation; a
`?gh=1` query param (or the popup toggle) leaves GitHub's native page untouched.

## Data flow

Content script → `chrome.runtime.sendMessage` RPC → background → `api.github.com` (PAT in
`chrome.storage.local`). Normalised domain objects (`src/lib/model.ts`) cross the boundary, never raw
GraphQL. The background keeps a short TTL cache keyed by query so navigating within a stack is fast.

Stacks are inferred from branches: walk `baseRefName` downwards (PR whose `headRefName` equals the
current base) until the default branch, and `headRefName` upwards (PRs whose base equals the current
head). Graphite's stack comment is only a fallback for ordering.

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
- `pnpm dev:harness` serves the fixture harness for visual checks (no token needed).
- Real-site check: load `.output/chrome-mv3` unpacked, add a PAT in Options, open github.com/pulls.
