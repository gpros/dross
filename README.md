# Food Tracker

A personal, mobile-first food-logging web app. The frontend is a static site (vanilla
HTML/CSS/JS, no build step) hosted on **GitHub Pages**; the database is a **Google Sheet**
accessed through a **Google Apps Script Web App** that acts as a thin JSON API. Access is
protected by a single **shared password** you choose — no Google Sign-In, no OAuth setup.

- **No servers**, no bundler, no runtime dependencies.
- **No secrets in the repo.** Only the API URL is committed (it's not sensitive). Your
  password lives only in the Apps Script Script Properties and your browser.
- Everything runs with just a Google account (for the Sheet), a GitHub account, and a browser.

```
[ Browser: static site on GitHub Pages ]
        │  POST JSON + shared password
        ▼
[ Google Apps Script Web App ]  ← checks the password, then reads/writes the Sheet
        │  SpreadsheetApp
        ▼
[ Google Sheet: Foods · Meals · MealItems · Settings ]
```

> **Note on auth.** This uses a shared password for a fast, personal-MVP setup. It's not as
> strong as per-account Google Sign-In (anyone who has *both* your `/exec` URL and the
> password could access the data), but it's plenty for a single-user trial and skips all the
> Google Cloud OAuth configuration. Google Sign-In is preserved in git history if you want
> to switch to it later.

## Repo layout

```
docs/                 ← GitHub Pages serves this folder
  index.html          app shell (password screen + views)
  styles.css          system-adaptive (light/dark) styles
  config.js           API_URL  ← you fill this in (non-secret; no password here)
  app.js              entry: password gate + tab navigation
  auth.js             shared-secret gate (password screen, localStorage, re-prompt)
  api.js              fetch wrapper (POST text/plain, re-prompt + retry on bad password)
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

You'll do this once. Budget ~10 minutes. Two moving parts: the **Sheet + Apps Script** and
**GitHub Pages**. No Google Cloud / OAuth console at all.

### 1. Create the Sheet and paste the backend

1. Go to <https://sheets.google.com> and create a new blank spreadsheet. Name it anything.
2. In the menu: **Extensions ▸ Apps Script**. A script editor opens in a new tab.
3. Delete the sample `function myFunction() {}` and paste the entire contents of
   [`apps-script/Code.gs`](apps-script/Code.gs).
4. Click **Save** (💾).
5. In the toolbar function dropdown, select **`setupSheet`** and click **Run**.
   - The first run asks you to **authorize** — approve the scope (it only touches this one
     spreadsheet). You'll see a "Google hasn't verified this app" warning because it's your
     own script; click **Advanced ▸ Go to … (unsafe)** and **Allow**.
   - ⚠️ **The first Run usually only completes the authorization and does NOT run the
     function.** After granting permission, click **▶ Run** again to actually execute it.
     Check **View ▸ Executions** — you want a `setupSheet` run marked *Completed*.
   - Go back to the Sheet tab and **reload the page**: you now have four tabs — **Foods**,
     **Meals**, **MealItems**, **Settings** — each with a header row. (Re-running
     `setupSheet` is safe.)

### 2. Set your password and deploy the Web App

1. In the Apps Script editor: **Project Settings** (⚙️ on the left) ▸ **Script Properties** ▸
   **Add script property**:
   - Property: `SHARED_SECRET` — Value: **a password of your choice** (make it long-ish).
   - Save.
2. **Deploy ▸ New deployment**:
   - Type (gear icon): **Web app**.
   - **Execute as: Me.**
   - **Who has access: Anyone with the link.**
     (Safe for this setup: the script rejects every request that doesn't carry your
     `SHARED_SECRET`. "Anyone with the link" only means the *endpoint* is reachable.)
   - Click **Deploy**, authorize if asked, and **copy the Web app URL** — it ends in `/exec`.
3. **Health check:** open that `/exec` URL in a browser. You should see
   `{"ok":true,"data":"health ok"}`. (This endpoint needs no password — it's just a ping.)

### 3. Fill in `config.js`

Edit [`docs/config.js`](docs/config.js) and paste your `/exec` URL:

```js
export const API_URL = "https://script.google.com/macros/s/AKfy…/exec"; // your /exec URL
```

Commit and push. (The URL is non-secret. Do **not** put your password here.)

### 4. Enable GitHub Pages

1. Push this repo to GitHub.
2. Repo **Settings ▸ Pages**:
   - **Source: Deploy from a branch.**
   - **Branch: `main`** (or `food-tracker` if that's where this lives), **Folder: `/docs`**. Save.
3. Wait ~1 minute, then open `https://<your-username>.github.io/<repo>/`.
   - Enter your **`SHARED_SECRET`** password once. It's saved in that browser (localStorage),
     so you won't be asked again on that device. "Forget password" (in the footer) clears it.

### 5. Local testing (optional)

From the repo root:

```bash
cd docs
python3 -m http.server 8137
```

Open <http://localhost:8137/index.html> and enter your password. (No origin configuration is
needed anymore — that was only for Google Sign-In.)

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

- **Password on every request.** The frontend sends your `SHARED_SECRET` in the JSON body
  of every POST (over HTTPS, never in the URL). The Apps Script compares it to the
  `SHARED_SECRET` Script Property and rejects mismatches with `unauthorized`. The password
  is stored in your browser's `localStorage` so you enter it only once per device.
- **A wrong/changed password never loses work.** If a call returns `unauthorized`, the app
  clears the stored password, re-prompts you, and retries the request once — so an
  in-progress meal survives (e.g. if you rotate the secret mid-session).
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
| App keeps asking for the password / `unauthorized` | The password you typed doesn't match the `SHARED_SECRET` Script Property, or that property isn't set. Set it, redeploy a **new version** (see above), and try again. |
| Nothing loads / network error in the app | `API_URL` in `config.js` is wrong or points at an old deployment. Re-copy the `/exec` URL. |
| `{"ok":false,"error":"sheet_missing"}` | Run `setupSheet()` in the Apps Script editor (remember: run it twice — the first run only authorizes). |
| Edits to `Code.gs` have no effect | You created a *new* deployment instead of a *new version* of the existing one (see above). |
| Wrong password is rejected | Type a wrong password on purpose — the app should refuse it and re-prompt. That's the expected pass. |

## Extending it later

The code is structured so these drop in without rework: weekly/monthly dashboards (same
client-side math over the paginated `getMeals`), exercise tracking (a new tab + new
`ACTIONS` entries via the generic dispatch), editing past meals, and soft-deleting foods.
Columns are read by header name, so adding fields (fiber, sugar, …) to a tab won't break
anything.
