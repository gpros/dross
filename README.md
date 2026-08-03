# Food Tracker

A personal, mobile-first food-logging web app. The frontend is a static site (vanilla
HTML/CSS/JS, no build step) hosted on **GitHub Pages**; the database is a **Google Sheet**
accessed through a **Google Apps Script Web App** that acts as a thin JSON API. Sign-in is
**Google Sign-In** — only your own Google account can read or write.

- **No servers**, no bundler, no runtime dependencies.
- **No secrets in the repo.** The OAuth Client ID and the API URL are public by design.
- Everything runs with just a Google account, a GitHub account, and a browser.

```
[ Browser: static site on GitHub Pages ]
        │  POST JSON + Google ID token
        ▼
[ Google Apps Script Web App ]  ← verifies your ID token, then reads/writes the Sheet
        │  SpreadsheetApp
        ▼
[ Google Sheet: Foods · Meals · MealItems · Settings ]
```

## Repo layout

```
docs/                 ← GitHub Pages serves this folder
  index.html          app shell + Google Identity Services script
  styles.css          system-adaptive (light/dark) styles
  config.js           API_URL + GOOGLE_CLIENT_ID  ← you fill these in (non-secret)
  app.js              entry: sign-in bootstrap + tab navigation
  auth.js             Google Sign-In (One Tap + button, in-memory token, refresh)
  api.js              fetch wrapper (POST text/plain, auto token-refresh + retry)
  state.js            in-memory catalog cache, settings, draft meal
  nutrition.js        client-side totals + "incomplete data" flags
  ui.js               escaping, toast, decimal parsing, shared summary-bar component
  editors.js          targets editor, food add/edit, quantity prompt (modals)
  meals.js            day grouping, whole-day meal fetching, quick-pick frequency
  views/log.js        Log view (summary, search, chips, draft, save)
  views/foods.js      Foods catalog (list, filter, edit, add)
  views/history.js    History (grouped by day, day totals, pagination)
  manifest.webmanifest + icon.svg   PWA "Add to Home Screen"
apps-script/Code.gs   the entire backend
tools/import_foods_notes.md   optional bulk food import
```

---

## Setup — step by step

You'll do this once. Budget ~20 minutes. There are three moving parts: the **Sheet +
Apps Script**, the **Google Cloud OAuth client**, and **GitHub Pages**.

### 1. Create the Sheet and paste the backend

1. Go to <https://sheets.google.com> and create a new blank spreadsheet. Name it anything.
2. In the menu: **Extensions ▸ Apps Script**. A script editor opens in a new tab.
3. Delete the sample `function myFunction() {}` and paste the entire contents of
   [`apps-script/Code.gs`](apps-script/Code.gs).
4. Click **Save** (💾).
5. In the toolbar function dropdown, select **`setupSheet`** and click **Run**.
   - The first run asks you to **authorize** — approve the scopes (it only touches this
     spreadsheet and makes external calls to Google's token-info endpoint).
   - Go back to the Sheet tab: you now have four tabs — **Foods**, **Meals**,
     **MealItems**, **Settings** — each with a header row. (Re-running `setupSheet` is safe.)

### 2. Create the Google Cloud OAuth client

Sign-in needs an OAuth **Client ID**. This lives in a Google Cloud project.

1. Go to <https://console.cloud.google.com>. Create a new project (top bar ▸ project
   picker ▸ **New Project**). Any name; no billing needed.
2. **OAuth consent screen** (left menu ▸ *APIs & Services ▸ OAuth consent screen*):
   - User type: **External**. Click Create.
   - Fill the required fields (app name, your email as support + developer contact). Save.
   - **Leave the app in "Testing" mode.** On the *Audience* / *Test users* screen, click
     **Add users** and add **your own Gmail address**.
   - ⚠️ **Testing mode with yourself as a test user is all you need.** You do **not** need
     to "publish" the app or go through Google verification — that's only for apps serving
     other people. As the sole user/test-user, sign-in works indefinitely.
3. **Create the OAuth Client ID** (*APIs & Services ▸ Credentials ▸ Create Credentials ▸
   OAuth client ID*):
   - Application type: **Web application**.
   - **Authorized JavaScript origins** — add each of these (Add URI per line):
     - `https://<your-github-username>.github.io`  ← your GitHub Pages origin
     - `http://localhost:8137`   ← for local testing (any port you use; see below)
     - `http://127.0.0.1:8137`
   - **Authorized redirect URIs:** none needed for Google Identity Services token flow.
   - Click **Create** and copy the **Client ID** (looks like
     `1234567890-abcdef.apps.googleusercontent.com`).

   > ⚠️ **Origin-mismatch gotcha.** The origin in the browser's address bar must **exactly**
   > match an Authorized JavaScript origin — scheme, host, and port, with **no trailing
   > slash and no path**. `http://localhost:8137` ✅ but `http://localhost:8137/` or
   > `.../index.html` ❌. If you see `redirect_uri_mismatch` / `origin_mismatch` or the
   > button silently does nothing, this is why.
   >
   > ⚠️ **Propagation delay.** After adding or changing an origin, Google can take a few
   > minutes (occasionally up to ~1 hour) to propagate. If it "should work" but doesn't,
   > wait and retry before debugging further.

### 3. Configure and deploy the Apps Script Web App

1. Back in the Apps Script editor: **Project Settings** (⚙️ left) ▸ **Script Properties** ▸
   **Add script property**, add two:
   - `CLIENT_ID` = the OAuth Client ID from step 2.
   - `ALLOWED_EMAIL` = your Gmail address (the only account allowed to use the API).
2. **Deploy ▸ New deployment**:
   - Type (gear icon): **Web app**.
   - **Execute as: Me**.
   - **Who has access: Anyone with the link.**
     (This is safe: the script itself rejects every request whose Google ID token isn't
     your `ALLOWED_EMAIL`. "Anyone with the link" only means the *endpoint* is reachable.)
   - Click **Deploy**, authorize if asked, and **copy the Web app URL** — it ends in
     `/exec`.
3. **Health check:** open that `/exec` URL in a browser. You should see
   `{"ok":true,"data":"health ok"}`.

### 4. Fill in `config.js`

Edit [`docs/config.js`](docs/config.js) and replace the two placeholders:

```js
export const API_URL = "https://script.google.com/macros/s/AKfy…/exec"; // your /exec URL
export const GOOGLE_CLIENT_ID = "1234567890-abcdef.apps.googleusercontent.com";
```

Commit and push. (Both values are non-secret — safe in a public repo.)

### 5. Enable GitHub Pages

1. Push this repo to GitHub.
2. Repo **Settings ▸ Pages**:
   - **Source: Deploy from a branch.**
   - **Branch: `main`**, **Folder: `/docs`**. Save.
3. Wait ~1 minute, then open `https://<your-username>.github.io/<repo>/`.
   - One Tap should sign you in silently if you have an active Google session; otherwise
     tap **Sign in with Google** once.

### 6. Local testing (optional)

From the repo root:

```bash
cd docs
python3 -m http.server 8137
```

Open <http://localhost:8137/index.html>. (This is why `http://localhost:8137` is in the
Authorized JavaScript origins. Use whatever port you like, but it must match an origin.)

---

## Redeploying after you edit `Code.gs`  ← read this, it trips everyone up

The `/exec` URL points at a specific **version** of the deployment. Editing and saving the
code does **not** change what the URL serves.

- ✅ **To publish changes to the same URL:** *Deploy ▸ **Manage deployments*** ▸ select your
  deployment ▸ ✏️ **Edit** ▸ **Version: New version** ▸ **Deploy**. Same URL, new code.
- ❌ **Do not** use *Deploy ▸ New deployment* for edits — that mints a **new** URL and your
  `config.js` keeps calling the old one.

(The frontend has no such issue — GitHub Pages redeploys automatically on push.)

---

## Bulk-importing an existing food list

See [`tools/import_foods_notes.md`](tools/import_foods_notes.md). In short: paste your food
names into a temporary **Import** tab (column A) and run the `importFoods()` function from
the Apps Script editor — it appends new names with blank nutrition, skipping duplicates.
No Python or OAuth needed because the editor already runs as you.

---

## How it works (design notes)

- **Auth on every request.** The frontend sends a Google **ID token** in the JSON body of
  every POST. The Apps Script verifies it against Google's `tokeninfo` endpoint and checks
  `aud === CLIENT_ID`, `email === ALLOWED_EMAIL`, and `email_verified`. Successful
  verifications are cached (`CacheService`) for the token's lifetime to keep things fast.
  The token is kept **in memory only**, never in `localStorage`.
- **Token expiry never loses work.** If a call returns `unauthorized`, the app silently
  refreshes the token via Google Identity Services and retries the request once — so an
  in-progress meal survives the ~1-hour token expiry.
- **All nutrition math is client-side.** The API returns raw rows; the browser joins meal
  items with the cached food catalog and computes `per-100g × grams / 100`.
- **Blank ≠ 0.** Unknown nutrition values are stored as empty cells and shown as "—";
  a real `0` is stored and shown as `0`. Totals that include a food with missing data are
  marked as lower bounds with a "≥" prefix.
- **Targets are current-only.** Changing your four daily targets re-scores every day, past
  and future, against the new values. There is no per-date target history by design.
- **Writes are serialized** with `LockService`, and numbers are written as real numbers
  (never locale-formatted strings) so a comma-decimal locale can't corrupt values.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Button does nothing / `origin_mismatch` | The current origin isn't an Authorized JavaScript origin (check scheme/host/port, no trailing slash). Wait for propagation. |
| `{"ok":false,"error":"unauthorized"}` for your own account | `CLIENT_ID` / `ALLOWED_EMAIL` script properties not set, or `config.js` Client ID doesn't match the one in Script Properties. |
| `{"ok":false,"error":"sheet_missing"}` | Run `setupSheet()` in the Apps Script editor. |
| Edits to `Code.gs` have no effect | You created a *new* deployment instead of a *new version* of the existing one (see above). |
| Another Google account can't be refused to test | Sign in with a different account — the app should reject it with `unauthorized`. That's the expected pass. |

## Extending it later

The code is structured so these drop in without rework: weekly/monthly dashboards (same
client-side math over the paginated `getMeals`), exercise tracking (a new tab + new
`ACTIONS` entries via the generic dispatch), editing past meals, and soft-deleting foods.
Columns are read by header name, so adding fields (fiber, sugar, …) to a tab won't break
anything.
