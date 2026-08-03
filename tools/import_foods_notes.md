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
