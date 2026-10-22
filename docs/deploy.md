# Releasing to the Chrome Web Store

Every push to `main` runs `.github/workflows/release.yml`: typecheck, tests, a build, a GitHub Release `v0.1.<run>`
carrying the zip, and, once the store secrets below exist, the same zip uploaded to the Chrome Web Store and submitted
for review. The workflow uses only GitHub's own actions (`actions/checkout`, `actions/setup-node`); pnpm is installed
from npm at the version `package.json` pins, and the store is driven with `curl` against its REST API.

The version is `major.minor` from `package.json` plus the workflow run number, so nothing is committed for a release
and every upload carries a higher version than the last, as the store requires. Bump `major.minor` by editing
`package.json`.

## One-time setup

### 1. The repository on GitHub

```bash
gh repo create carbonlayer --private --source=. --remote=origin --push
```

(or create it in the GitHub UI and `git remote add origin … && git push -u origin main`). The first push runs the
workflow and publishes the GitHub Release; the store steps are skipped until the secrets exist, and the log says so.

### 2. The Chrome Web Store item

1. Register at https://chrome.google.com/webstore/devconsole (one-time fee) with the Google account that will own
   the extension.
2. Build a zip locally: `pnpm zip` writes `.output/carbonlayer-<version>-chrome.zip`.
3. In the developer dashboard, **New item** → upload that zip. The item's 32-letter id is in the dashboard URL
   (`…/devconsole/<publisher>/<item id>/edit`); it is the `CWS_EXTENSION_ID` secret.
4. Fill in the listing before the first publish, since the API refuses to publish an incomplete one:
   - **Store listing**: description, category (Developer Tools), language, the 128 px icon (`public/icon/128.png`),
     at least one screenshot of 1280×800 or 640×400 (make them from the fixture harness, `app.html?fixtures=1#/inbox`,
     or from GitHub itself; `docs/screenshots/` has material to crop).
   - **Privacy**: single purpose (a Graphite-style inbox and pull request page on github.com); permission
     justifications — `storage`: the user's views and settings; host `https://github.com/*`: the extension reads and
     posts to github.com with the user's own session, which is the whole product; no remote code; data use: nothing
     is collected or sent anywhere but github.com.
   - **Distribution**: Unlisted keeps it reachable only by link, which is enough for a team; Public needs the listing
     to pass the fuller review.
5. Publish once from the dashboard or leave it to the workflow; either way the first review of an extension with a
   github.com host permission is manual and can take days. Later uploads are reviewed too, usually faster.

### 3. A service account for the workflow (Google Cloud)

The workflow drives the store's API v2 as a Google service account: no OAuth consent screen, and no refresh token that
expires. (API v1.1 and its OAuth refresh tokens stopped being supported on 15 October 2026.)

1. At https://console.cloud.google.com, with the Google account that owns the store item, pick or create a project.
2. **APIs & Services → Library**: enable **Chrome Web Store API**.
3. **IAM & Admin → Service accounts → Create service account**: any name (e.g. `carbonlayer-release`), no roles.
   Copy its email (`…@<project>.iam.gserviceaccount.com`).
4. Open it → **Keys → Add key → Create new key → JSON**. A `.json` file downloads; it is the `CWS_SERVICE_ACCOUNT_KEY`
   secret. Delete the file once the secret is set (step 5).
5. In the store's developer dashboard, **Account**: add the service account's email. A publisher takes one service
   account.

### 4. The publisher id

The dashboard URL is `…/devconsole/<publisher id>/<item id>/edit`; the publisher id is also under **Publisher →
Settings**. It is the `CWS_PUBLISHER_ID` secret.

### 5. Secrets on the repository

**Settings → Secrets and variables → Actions → New repository secret**, or from the repository's folder:

```bash
gh secret set CWS_SERVICE_ACCOUNT_KEY < ~/Downloads/<the key>.json
```

| Secret | Value |
| --- | --- |
| `CWS_EXTENSION_ID` | the item id from step 2.3 |
| `CWS_PUBLISHER_ID` | from step 4 |
| `CWS_SERVICE_ACCOUNT_KEY` | the JSON key from step 3.4, whole |

The store step stays off until the repository **variable** `CWS_PUBLISH` is set to `true` (same page, **Variables**
tab, or `gh variable set CWS_PUBLISH --body true`). Set it, and from the next push to `main` the workflow uploads and
submits each release; set it to anything else to pause store uploads while GitHub Releases continue. **Actions →
Release** shows the store's answers: an upload ends `Upload: SUCCEEDED` (one the store is still processing is asked after
every ten seconds, for five minutes at most), and a submission answers a `state` of `PENDING_REVIEW` (or `STAGED`,
`PUBLISHED`, `PUBLISHED_TO_TESTERS`). Run it by hand from the same page (**Run workflow**) to release without a push.

## When something fails

- `invalid_grant` or `unauthorized_client` while fetching the token: the key was deleted or the secret holds something
  else. Create a new key (step 3.4) and set the secret again.
- `403` / `PERMISSION_DENIED` from the store: the service account is not on the publisher's **Account** page (step
  3.5), the Chrome Web Store API is not enabled in its project (step 3.2), or `CWS_PUBLISHER_ID` names another
  publisher.
- `Upload: FAILED`, or an error saying an item is in review: the store takes one pending version at a time. Wait for the
  review, then re-run the workflow.
- An error naming a listing field: finish that part of the listing in the dashboard (step 2.4).
- Without any store access at all, the GitHub Release still carries the zip: unzip it and load it unpacked, as during
  development.
