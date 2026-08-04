// state.js — in-memory app state: food catalog cache, settings, and the draft meal.
//
// The catalog is cached after first load and refreshed whenever foods change. Nothing
// here is persisted to disk; a page reload starts fresh (online-only by design).

import * as api from "./api.js";

const state = {
  foods: [],          // [{id, name, kcal_100g, protein_100g, carbs_100g, fat_100g}]
  foodsById: new Map(),
  settings: null,     // { target_kcal, target_protein_g, ... } (values may be null)
  meals: [],          // recent window of meals, newest-first (shared by Log + History)
  mealsHasMore: false,// true if older meals exist beyond the loaded window
  mealsNextBefore: null, // timestamp cursor for loading older meals
  draft: {            // in-progress meal on the Log view
    timestamp: null,  // ISO string; set when the Log view initializes
    note: "",
    items: [],        // [{food_id?, food_name?, name, quantity_g, kcal_100g?, ...}]
  },
};

const BOOTSTRAP_LIMIT = 100; // recent meals preloaded on startup (covers today + quick-picks)

export function getFoods() { return state.foods; }
export function getFoodById(id) { return state.foodsById.get(String(id)) || null; }
export function getSettings() { return state.settings; }
export function getDraft() { return state.draft; }
export function getRecentMeals() { return state.meals; }
export function getMealsHasMore() { return state.mealsHasMore; }
export function getMealsNextBefore() { return state.mealsNextBefore; }

// Bumped whenever meal data changes (a meal is saved). Views compare against the version
// they last rendered so they can reuse cached data on tab switches and only re-fetch when
// something actually changed — avoids hitting the (slow) backend on every tab tap.
let mealsVersion = 0;
export function getMealsVersion() { return mealsVersion; }
export function bumpMealsVersion() { mealsVersion++; return mealsVersion; }

let foodsLoaded = false;

function indexFoods() {
  state.foodsById = new Map(state.foods.map((f) => [String(f.id), f]));
  state.foods.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export async function loadFoods(force = false) {
  if (foodsLoaded && !force) return state.foods;
  const data = await api.getFoods();
  state.foods = data.foods || [];
  indexFoods();
  foodsLoaded = true;
  return state.foods;
}

function setFoods(list) {
  state.foods = list || [];
  indexFoods();
  foodsLoaded = true;
}

function setMeals(list, hasMore, nextBefore) {
  state.meals = list || [];
  state.mealsHasMore = !!hasMore;
  state.mealsNextBefore = nextBefore ?? null;
}

// Load foods + settings + a recent window of meals in a SINGLE request. Falls back to the
// legacy three separate calls if the backend hasn't been redeployed with getBootstrap yet,
// so the app keeps working during the redeploy window.
export async function loadBootstrap() {
  try {
    const data = await api.getBootstrap({ limit: BOOTSTRAP_LIMIT });
    setFoods(data.foods);
    state.settings = data.settings || {};
    setMeals(data.meals, data.hasMore, data.nextBefore);
  } catch (err) {
    if (err && err.code === "unknown_action") {
      // Old backend: fetch the pieces separately (still works, just slower).
      const [foods, settings, meals] = await Promise.all([
        api.getFoods(),
        api.getSettings(),
        api.getMeals({ limit: BOOTSTRAP_LIMIT }),
      ]);
      setFoods(foods.foods);
      state.settings = settings.settings || {};
      setMeals(meals.meals, meals.hasMore, meals.nextBefore);
    } else {
      throw err;
    }
  }
}

// Prepend a just-saved meal to the cache (avoids a refetch) and bump the version so views
// re-render. `meal` is the object returned by addMeal ({ id, timestamp, note, items }).
export function prependMeal(meal) {
  state.meals.unshift(meal);
  bumpMealsVersion();
}

// Append an older page of meals fetched via "Load more" in History.
export function appendOlderMeals(list, hasMore, nextBefore) {
  state.meals = state.meals.concat(list || []);
  state.mealsHasMore = !!hasMore;
  state.mealsNextBefore = nextBefore ?? null;
}

// Merge a single food (from add/update) into the cache in place.
export function upsertFood(food) {
  const idx = state.foods.findIndex((f) => String(f.id) === String(food.id));
  if (idx >= 0) state.foods[idx] = food;
  else state.foods.push(food);
  indexFoods();
  return food;
}

export async function loadSettings(force = false) {
  if (state.settings && !force) return state.settings;
  const data = await api.getSettings();
  state.settings = data.settings || {};
  return state.settings;
}

export function setSettings(settings) {
  state.settings = settings;
  return settings;
}

// ---- Draft meal management ----

export function resetDraft() {
  state.draft = { timestamp: nowLocalIso(), note: "", items: [] };
  return state.draft;
}

export function setDraftTimestamp(iso) { state.draft.timestamp = iso; }
export function setDraftNote(note) { state.draft.note = note; }

export function addDraftItem(item) {
  state.draft.items.push(item);
}

export function updateDraftItemQty(index, qty) {
  if (state.draft.items[index]) state.draft.items[index].quantity_g = qty;
}

export function removeDraftItem(index) {
  state.draft.items.splice(index, 1);
}

export function draftIsEmpty() {
  return state.draft.items.length === 0;
}

// ISO 8601 with local timezone offset (so "now" reflects the user's clock).
export function nowLocalIso() {
  return toLocalIso(new Date());
}

export function toLocalIso(d) {
  const pad = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    d.getFullYear() +
    "-" + pad(d.getMonth() + 1) +
    "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) +
    ":" + pad(d.getMinutes()) +
    ":" + pad(d.getSeconds()) +
    sign + pad(Math.floor(abs / 60)) + ":" + pad(abs % 60)
  );
}
