# CarbonLayer – Graphite UI for GitHub

We have Graphite at home.

A Chrome extension that makes GitHub's pull requests look and work like [Graphite](https://graphite.dev):

- **Inbox** on the GitHub homepage (`github.com`, when signed in; signed out it stays GitHub's own page, and so does
  GitHub's pull request dashboard at `/pulls`): several configurable views on one page (Needs your review, Needs
  your team's review, Returned to you, Ready to merge, Drafts, Waiting for review or checks, Merging
  and recently merged, Waiting for author), each either one of GitHub's own inbox sections
  (`inbox:<section>`) or a GitHub search query, with review, CI and merge status per row. Views are
  stored in your browser profile and can be shared as a link. Graphite's own "Share section" links can be
  imported too ("Import from Graphite…" in the inbox, or the options page): each becomes a view whose search
  approximates Graphite's filter, and the preview lists what GitHub's search cannot express.
- **Pull request page**: the stack at the top, one vertical scroll (description → activity → diff),
  CI checks, reviewers and a single "next step" merge card in a right sidebar, diffs rendered with
  [`@pierre/diffs`](https://diffs.com), and Graphite's keyboard shortcuts.

GitHub's own page is one click away: a "GitHub | CarbonLayer" switch in GitHub's header, at the top right next to the
+ and notification buttons, flips the homepage or the pull request page between GitHub's view and this one, in
place (remembered per surface, like the popup's switches). Add `?gh=1` to any URL to see GitHub's page just once.

## Install (unpacked, for development)

```bash
pnpm install
pnpm build
```

Then in Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and
pick the `.output/chrome-mv3` folder. There is no token to set up: the extension reads and writes
through your github.com session, so sign in to github.com in that browser profile and visit
`https://github.com/`. The extension's **Options** page holds the inbox views and scope, the
merge method, diff layout and theme, and the on/off switches.

## Develop

```bash
pnpm dev          # WXT dev server with HMR; loads the extension in a dev Chrome profile
pnpm typecheck    # tsc
pnpm test         # vitest
pnpm build        # production build into .output/chrome-mv3
```

To look at the UI without loading the extension, build and serve the output folder, then open
`app.html?fixtures=1#/inbox` or `app.html?fixtures=1#/pr/acme/widgets/42`:

```bash
pnpm build && (cd .output/chrome-mv3 && python3 -m http.server 4310)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit, and `docs/research/` for the notes
behind the design (Graphite's conventions, the github.com endpoints read and written, the diff library).
