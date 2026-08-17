# dross — Food Tracker

A single-user app for logging what you eat and tracking it against daily nutrition targets —
built to run for free with no servers to maintain.

The frontend is a static site (vanilla HTML/CSS/JS, no build step) served from GitHub Pages;
the backend is a Google Apps Script Web App over a Google Sheet, protected by a single shared
password (no OAuth). The whole stack:

```
[ Browser: static site on GitHub Pages ]
        │  POST JSON + shared password
        ▼
[ Google Apps Script Web App ]  ← checks the password, then reads/writes the Sheet
        │  SpreadsheetApp
        ▼
[ Google Sheet: Foods · Meals · MealItems · Settings · Recipes ]
```

## Features

- **Log meals** from a searchable **Foods** catalog; per-meal nutrition is computed on the client.
- **Daily targets** — four nutrition targets score every day; changing them re-scores past and future live.
- **Foods catalog** — add/edit foods with per-100g nutrition and optional default serving sizes (½/1/2/3 chips). Each food has **English / Spanish / free-form** names, and search matches any of them.
- **Dishes (recipes)** — compose a dish from ingredient foods; its nutrition is derived from the ingredients, so it stays correct when they change.
- **History** — meals grouped by day with day totals; tap any meal to edit or delete it.
- **Installable PWA**, system light/dark, and honest handling of incomplete data (blank ≠ 0; totals with unknowns shown as "≥" lower bounds).
- **Optional starter list** — a `seedFoods()` script loads ~200 common Mediterranean foods (English + Spanish names, macros, serving sizes) in one run.

## Where's the code?

This `main` branch is just a landing page. The application and full setup instructions live on
the **[`food-tracker`](../../tree/food-tracker)** branch:

- `docs/` — the frontend (GitHub Pages root)
- `apps-script/Code.gs` — the entire backend
- `README.md` — step-by-step setup, deployment, and design notes
