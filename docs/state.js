// state.js — in-memory app state: food catalog cache, settings, and the draft meal.
//
// The catalog is cached after first load and refreshed whenever foods change. Nothing
// here is persisted to disk; a page reload starts fresh (online-only by design).

import * as api from "./api.js";

const state = {
  foods: [],          // [{id, name, kcal_100g, protein_100g, carbs_100g, fat_100g}]
  foodsById: new Map(),
  settings: null,     // { target_kcal, target_protein_g, ... } (values may be null)
  draft: {            // in-progress meal on the Log view
    timestamp: null,  // ISO string; set when the Log view initializes
    note: "",
    items: [],        // [{food_id?, food_name?, name, quantity_g, kcal_100g?, ...}]
  },
};

export function getFoods() { return state.foods; }
export function getFoodById(id) { return state.foodsById.get(String(id)) || null; }
export function getSettings() { return state.settings; }
export function getDraft() { return state.draft; }

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
