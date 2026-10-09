# Graphite-style GitHub

A Chrome extension that makes GitHub's pull requests look and work like [Graphite](https://graphite.dev):

- **Inbox** at `github.com/pulls`: several configurable views on one page (Needs your review,
  Returned to you, Approved, Drafts, Waiting for reviewers, Merging and recently merged, Waiting for
  author), each a GitHub search query, with review, CI and merge status per row. Views are stored in
  your browser profile and can be shared as a link.
- **Pull request page**: the stack at the top, one vertical scroll (description → activity → diff),
  CI checks, reviewers and a single "next step" merge card in a right sidebar, diffs rendered with
  [`@pierre/diffs`](https://diffs.com), and Graphite's keyboard shortcuts.

GitHub's own page is one click away ("Open on GitHub", or add `?gh=1` to any URL).

## Install (unpacked, for development)

```bash
pnpm install
pnpm build
```

Then in Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and
pick the `.output/chrome-mv3` folder. Open the extension's **Options** page and paste a GitHub
personal access token:

- classic token: scopes `repo` and `read:org`; or
- fine-grained token: Pull requests (read/write), Contents (read; write if you want to merge),
  Metadata (read), Commit statuses (read), and the organisation's Members (read) for team reviews.
  A fine-grained token covers a single organisation.

Click **Test connection**, then visit `https://github.com/pulls`.

## Develop

```bash
pnpm dev          # WXT dev server with HMR; loads the extension in a dev Chrome profile
pnpm typecheck    # tsc
pnpm test         # vitest
pnpm build        # production build into .output/chrome-mv3
```

To look at the UI without a token, build and serve the output folder, then open
`app.html?fixtures=1#/inbox` or `app.html?fixtures=1#/pr/acme/widgets/42`:

```bash
pnpm build && (cd .output/chrome-mv3 && python3 -m http.server 4310)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit, and `docs/research/` for the notes
behind the design (Graphite's conventions, the GitHub API fields used, the diff library).
