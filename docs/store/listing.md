# Chrome Web Store listing

What to paste into the developer dashboard. The images in this folder are made by the store screenshot script in the
e2e scratchpad (`store-shots.mjs`) from the fixture harness; regenerate them after a visible change.

## Store listing

**Description** (the field, verbatim):

```
CarbonLayer turns GitHub's pull requests into a Graphite-style inbox and pull request page, using nothing but the GitHub session you are already signed in with. No token, no account, no server of its own: it talks to github.com the way GitHub's own pages do.

INBOX
The github.com homepage becomes an inbox with configurable sections: Needs your review, Returned to you, Approved, Waiting for reviewers, Drafts, Needs anyone's review, Merging and recently merged, Waiting for author. Each section is a GitHub search you can edit with a Graphite-style filter editor, scoped to one organization (or your own account) and the repositories you choose. Every row shows review status, CI status (required failures in red, optional ones in amber, running in between) and merge status, line counts, labels, stack position and the last update. Sections load more on demand, can be shared as a link, and can be imported from your Graphite inbox in one click.

PULL REQUEST PAGE
The stack at the top, one vertical scroll (description, activity, diff), the checks and reviewers on the right, and the diff rendered by @pierre/diffs. Approve, request changes, comment on lines, resolve threads, mark files viewed, add or re-request reviewers, re-run failed checks, convert to draft, enable auto-merge and merge, all in place. Graphite's keyboard shortcuts work: j/k to move, n/p between files, f to toggle a file viewed, r a to approve, c r to re-run failed checks, ? for the full list.

SWITCH ANY TIME
A "GitHub | CarbonLayer" switch sits in GitHub's header. It changes only the tab you are in, and new tabs open the way you last left it. Add ?gh=1 to any URL to see GitHub's page once. GitHub's own pull request dashboard at /pulls is never touched.

PRIVACY
CarbonLayer reads and writes github.com with your own browser session and stores your sections and settings in your Chrome profile (synced with your Chrome account). It collects nothing and sends nothing anywhere but github.com.

We have Graphite at home.
```

- **Category**: Developer Tools (under Productivity if the picker asks for a parent).
- **Language**: English.
- **Store icon**: `icon-128.png` in this folder (`public/icon/128.png`).
- **Screenshots** (1280×800 JPEG, in this order): `1-inbox-light.jpg`, `2-pull-request-light.jpg`, `1-inbox-dark.jpg`,
  `2-pull-request-dark.jpg`.
- **Small promo tile** (440×280): `small-promo-tile.jpg`. **Marquee promo tile** (1400×560): `marquee-promo-tile.jpg`.
  Both optional.
- **Official URL**: None (needs a site verified in Search Console; not worth it).
- **Homepage URL**: the repository, e.g. `https://github.com/DJCrossman/carbonlayer`, once it exists.
- **Support URL**: its issues page, e.g. `https://github.com/DJCrossman/carbonlayer/issues`.
- **Mature content**: off.

## Privacy tab

- **Single purpose**: A Graphite-style inbox and pull request page for GitHub, rendered on github.com with the user's
  own session.
- **Permission justifications**:
  - `storage`: keeps the user's inbox sections, chosen organization and repositories, and display settings, synced
    across their Chrome profile.
  - Host permission `https://github.com/*`: the extension replaces the GitHub homepage and pull request pages with
    its own views, and reads and posts to github.com's own pages and JSON routes with the user's session to show and
    act on pull requests. This is the product; it does nothing on any other site.
- **Remote code**: No, I am not using remote code. (Everything ships in the package.)
- **Data usage**: tick nothing collected. Certify the three disclosures: no sale of data, no use unrelated to the
  single purpose, no use for creditworthiness or lending.

## Distribution tab

- **Visibility**: Unlisted (anyone with the link can install; no search listing) until the listing has screenshots
  and a review behind it; Public afterwards.
- **Regions**: all.

## Test instructions (the "Access" section)

The reviewer needs a GitHub account that is signed in. Suggested text:

```
Sign in to github.com with any account, then open https://github.com/: the homepage shows the CarbonLayer inbox
(choose an organization or your own account when asked). Open any pull request, e.g.
https://github.com/microsoft/vscode/pull/1, to see the pull request page. The "GitHub | CarbonLayer" switch in GitHub's
header, top right, restores GitHub's own page for that tab. No test credentials are needed; nothing leaves github.com.
```
