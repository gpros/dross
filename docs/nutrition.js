// nutrition.js — client-side nutrition math. The API returns raw data only; all
// aggregation happens here by joining meal items with the cached food catalog.

import { getFoodById } from "./state.js";

const MACROS = ["kcal", "protein", "carbs", "fat"];
const PER100_KEY = {
  kcal: "kcal_100g",
  protein: "protein_100g",
  carbs: "carbs_100g",
  fat: "fat_100g",
};

function emptyTotals() {
  return {
    kcal: 0, protein: 0, carbs: 0, fat: 0,
    // Per-macro flag: true if at least one contributing food lacked that value.
    incomplete: { kcal: false, protein: false, carbs: false, fat: false },
    incompleteFoods: new Set(), // food ids missing ANY nutrient they were eaten with
  };
}

// A meal item is { food_id?, name, quantity_g, and optionally inline nutrition }.
// Resolve the food's per-100g values from the item itself or the catalog.
function per100(item, macro) {
  const key = PER100_KEY[macro];
  if (item && Object.prototype.hasOwnProperty.call(item, key) && item[key] != null) {
    return item[key];
  }
  const food = item && item.food_id ? getFoodById(item.food_id) : null;
  if (food && food[key] != null) return food[key];
  return null; // unknown
}

// Accumulate one item's contribution into `totals`.
export function addItemToTotals(totals, item) {
  const qty = Number(item.quantity_g) || 0;
  MACROS.forEach((macro) => {
    const value = per100(item, macro);
    if (value == null) {
      totals.incomplete[macro] = true;
      if (item.food_id) totals.incompleteFoods.add(String(item.food_id));
    } else {
      totals[macro] += (value * qty) / 100;
    }
  });
  return totals;
}

// Totals for a single list of items (a meal or a draft).
export function itemsTotals(items) {
  const totals = emptyTotals();
  (items || []).forEach((it) => addItemToTotals(totals, it));
  return totals;
}

// Totals across many meals (each meal has an `items` array).
export function mealsTotals(meals) {
  const totals = emptyTotals();
  (meals || []).forEach((m) => (m.items || []).forEach((it) => addItemToTotals(totals, it)));
  return totals;
}

// Merge b into a (used to fold a provisional draft into today's totals).
export function combineTotals(a, b) {
  const out = emptyTotals();
  MACROS.forEach((m) => {
    out[m] = a[m] + b[m];
    out.incomplete[m] = a.incomplete[m] || b.incomplete[m];
  });
  a.incompleteFoods.forEach((id) => out.incompleteFoods.add(id));
  b.incompleteFoods.forEach((id) => out.incompleteFoods.add(id));
  return out;
}

export function anyIncomplete(totals) {
  return MACROS.some((m) => totals.incomplete[m]);
}

// Compute a dish's per-100g nutrition from its ingredients [{food_id, quantity_g}].
// per-100g = macro_total / total_weight * 100; a macro is null (unknown) if any ingredient
// is missing it, so downstream "≥" handling applies. Returns { *_100g, total_g }.
export function computeDishNutrition(ingredients) {
  const totalG = (ingredients || []).reduce((s, i) => s + (Number(i.quantity_g) || 0), 0);
  const t = itemsTotals(ingredients);
  const out = { total_g: totalG };
  MACROS.forEach((m) => {
    out[PER100_KEY[m]] = (t.incomplete[m] || totalG <= 0) ? null : (t[m] / totalG) * 100;
  });
  return out;
}

export { MACROS, PER100_KEY };
