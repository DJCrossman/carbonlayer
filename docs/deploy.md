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

### 3. API access (Google Cloud)

1. At https://console.cloud.google.com create a project (any name) with the same Google account.
2. **APIs & Services → Library**: enable **Chrome Web Store API**.
3. **APIs & Services → OAuth consent screen**: External; an app name and your email; no scopes need listing. Then
   **Publish app** so the publishing status is *In production*. In *Testing* status Google expires refresh tokens
   after seven days and the workflow would start failing with `invalid_grant` a week later.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**: application type **Desktop app**. Keep
   the client id and secret: they are the `CWS_CLIENT_ID` and `CWS_CLIENT_SECRET` secrets.

### 4. A refresh token for the workflow

1. Open this URL in a browser signed in as the store owner (fill in the client id):

   ```text
   https://accounts.google.com/o/oauth2/v2/auth?client_id=CLIENT_ID&redirect_uri=http://localhost&response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&prompt=consent
   ```

2. Approve. The browser is sent to `http://localhost/?code=…`, which shows a connection error; that is expected.
   Copy the `code` value from the address bar (if it contains `%2F`, replace it with `/`).
3. Exchange it within a few minutes:

   ```bash
   curl -sS -X POST https://oauth2.googleapis.com/token \
     -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET \
     -d code=CODE -d grant_type=authorization_code -d redirect_uri=http://localhost
   ```

   The answer's `refresh_token` is the `CWS_REFRESH_TOKEN` secret. It stays valid as long as the OAuth client exists
   and access is not revoked (and the consent screen is in production, step 3.3).

### 5. Secrets on the repository

**Settings → Secrets and variables → Actions → New repository secret**, four times:

| Secret | Value |
| --- | --- |
| `CWS_EXTENSION_ID` | the item id from step 2.3 |
| `CWS_CLIENT_ID` | from step 3.4 |
| `CWS_CLIENT_SECRET` | from step 3.4 |
| `CWS_REFRESH_TOKEN` | from step 4.3 |

From the next push to `main` the workflow uploads and submits each release. **Actions → Release** shows the store's
answers: an upload answers `"uploadState": "SUCCESS"`, a submission `"status": ["OK"]`; `PUBLISHED_WITH_FRICTION_WARNING`
in the status is fine too. Run it by hand from the same page (**Run workflow**) to release without a push.

## When something fails

- `invalid_grant` while fetching the token: the refresh token expired or was revoked. Redo step 4 (and check step 3.3).
- `uploadState: FAILURE` with `ITEM_NOT_UPDATABLE`: a previous submission is still in review; the store takes one
  pending version at a time. Wait for the review, then re-run the workflow.
- A `PUBLISH_*` error naming a listing field: finish that part of the listing in the dashboard (step 2.4).
- Without any store access at all, the GitHub Release still carries the zip: unzip it and load it unpacked, as during
  development.
