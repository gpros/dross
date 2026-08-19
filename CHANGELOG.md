# Changelog

Notable changes to the Food Tracker, newest first. Dates are absolute.

## 2026-08-20

### Popup polish

Centered the `Foods | Dishes` segment in the bottom bar (✕ stays right), and inset the popup ~5px
on the top/left/right so it's slightly narrower/centered and a bit taller (bottom stays flush).
Version → **version 4**.

## 2026-08-19

### Catalog controls pinned to a fixed bottom bar

In the Foods/Dishes popup, the `Foods | Dishes` segment, the active view's controls (search, "+ Add
food"/"+ New dish", "Missing data only"), and the ✕ now live in a **fixed bottom bar**; only the
list scrolls above it. Each catalog view renders its list into the popup body and its controls into
the bottom bar (`show(opts, controlsHost)`). History keeps its top header. Version → **version 3**.

### Log is the home screen; Foods/History become popups

Reworked navigation. The bottom tab bar is gone; the **Log** screen is the single base view with
two buttons at the top:

- **Foods** and **History** now open as **bottom-sheet popups** (title + **X** in the header; close
  with the X or by tapping the backdrop).
- **Dishes** folded into the Foods popup as a *Foods | Dishes* segmented control — one catalog popup.
- The popups use a dedicated host at `z-index:45`, **below** the editors' `#modal-host` (50), so
  add/edit editors (food, dish, meal) stack *above* an open popup and return to it on close.
- The Log "missing data" warning now opens the Foods popup (with the incomplete filter) instead of
  switching tabs.

Frontend-only change → version label bumped to **version 2**.

## 2026-08-17

### Three names per food/dish (English / Spanish / free-form)

Every food and dish now carries three name fields: `name` (English, the primary), `name_es`
(Spanish), and `name_free` (a free-form label). Notes/decisions:

- **At least one** name is required (English is no longer mandatory).
- **Display** falls back English → Spanish → free-form (first non-empty). In **search results**,
  the row shows the name that actually matched your query (so a Spanish search shows the Spanish
  name).
- **Search** matches any of the three (accent/case-insensitive).
- **Uniqueness** (`name_taken`) is enforced on the **English** name only; Spanish/free-form may
  repeat.
- Schema gained `name_es` / `name_free` columns — **re-run `setupSheet()`** after redeploying the
  backend (idempotent; existing rows keep their `name` as their English name).

### Frontend version label (debug)

`APP_VERSION` in `docs/app.js` renders as "version N" in the account footer — a purely cosmetic
cue to confirm which frontend build a device is running. Bump it on each frontend commit.

Why it exists: GitHub Pages serves assets with `Cache-Control: max-age=600`, so after a deploy a
browser can keep the **old** JS for up to ~10 minutes. If a change doesn't appear: hard-refresh
(Cmd/Ctrl+Shift+R), use a private window, or wait; a PWA added to the home screen needs a full
close/reopen. The version label tells you when the new build is actually live.

### Mediterranean starter food list (`seedFoods`)

`apps-script/seed_foods.gs` adds ~200 common Mediterranean foods (English + Spanish names, macros,
and serving sizes where a standard portion exists) via a `seedFoods()` function you run once from
the Apps Script editor — same no-password pattern as `importFoods()`. Idempotent (skips foods whose
English name already exists); the file can be deleted after seeding.

- **Values are per 100 g, raw / as-purchased** — i.e. what a package label shows. Weigh food *raw*
  and multiply; cooking afterwards doesn't change the totals (cooking mostly changes water content,
  hence the per-100g density, not the total macros). Foods eaten raw are unaffected.
- Pasta/rice/legumes use the **dry** values; meat/fish are raw. Values are standard references —
  adjust any to match your own labels.

Run steps: `tools/import_foods_notes.md`.

### Docs

README brought up to date (repo layout now lists `views/dishes.js` and `apps-script/seed_foods.gs`;
architecture diagram includes the `Recipes` tab; added the version-label and starter-list notes and
a caching troubleshooting row).
