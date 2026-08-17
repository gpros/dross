# Bulk-importing foods

You may already have a list of foods you eat. Rather than adding them one at a time in the
app, import them in bulk. The API requires a Google ID token for every write, so the
simplest path is **not** a Python script that has to do OAuth — it's a small function that
already runs as you inside the Apps Script editor.

`importFoods()` in [`../apps-script/Code.gs`](../apps-script/Code.gs) does exactly this.

## How to use it

1. Open your spreadsheet, then **Extensions ▸ Apps Script** (the same project that holds
   `Code.gs`).
2. In the spreadsheet, create a new tab named **`Import`** (exact name, case-sensitive).
3. Put your food **names in column A**, one per row. An optional `name` header in `A1` is
   fine — it's skipped automatically.

   ```
   A
   ─────────────────
   Chicken breast
   Brown rice
   Olive oil
   Greek yogurt
   Banana
   ```

   If your list is a CSV of names, paste it into A1 and use **Data ▸ Split text to columns**,
   or just paste one name per line into column A.
4. In the Apps Script editor, choose **`importFoods`** in the function dropdown and click
   **Run**. (Authorize on first run if prompted.)
5. The function returns something like `imported 5 foods, skipped 0 existing` (visible in
   the execution log, **View ▸ Executions**). New names are appended to the **Foods** tab
   with **blank nutrition**; existing names (case-insensitive) are skipped, so re-running is
   safe.
6. Delete the **Import** tab when you're done (optional), and fill in nutrition values later
   from the app's **Foods** view.

## Notes

- Only **names** are imported. Nutrition values start blank ("unknown") — the same state a
  food gets when you create it inline while logging a meal. Fill them in from the Foods view
  whenever convenient; missing-data foods are visually flagged there.
- Because names are unique case-insensitively, importing a name you already have is a no-op.
- If you'd rather import nutrition too, you can extend `importFoods()` to read more columns
  (B–E for kcal/protein/carbs/fat) — the Foods tab reads columns by header name, so the
  schema is flexible. This isn't needed for the MVP.

## Seeding a starter Mediterranean food list (with macros)

If you want a ready-made catalog instead of typing foods in, run **`seedFoods()`** from
[`../apps-script/seed_foods.gs`](../apps-script/seed_foods.gs). It adds ~200 common
Mediterranean-diet foods, each with an **English and Spanish name**, **macros per 100 g**, and a
**serving size** where a standard portion exists (a tbsp of olive oil, a slice of bread, an egg…).

1. In the Apps Script editor (the project that holds `Code.gs`), add a new script file, name it
   **`seed_foods`**, and paste the contents of `apps-script/seed_foods.gs`.
2. Make sure you've run **`setupSheet()`** at least once (so the Foods tab has the `name_es` and
   `name_free` columns).
3. Choose **`seedFoods`** in the function dropdown and click **Run**. Check **View ▸ Executions** —
   you'll see e.g. `seeded 200 foods, skipped 0 existing`.
4. Reload the app: the foods appear in the **Foods** tab, searchable by either language. You can
   delete the `seed_foods` file afterwards.

**Values are per 100 g, raw / as-purchased** — i.e. what a package label shows. Weigh food *raw*
and multiply; cooking afterward doesn't change the totals. Pasta/rice/legumes use the **dry**
values; meat/fish are raw. Adjust any value to match your own labels. Re-running is safe — foods
whose English name already exists are skipped.
