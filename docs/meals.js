// meals.js — date/day helpers and meal fetching that respects whole-day boundaries,
// so daily totals are never understated by a partial page.

import * as api from "./api.js";
import { toLocalIso } from "./state.js";

// Local calendar-day key "YYYY-MM-DD" for an ISO timestamp.
export function localDayKey(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

export function startOfLocalDay(d = new Date()) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

export function startOfTodayIso() {
  return toLocalIso(startOfLocalDay());
}

// Human label for a day key relative to today.
export function dayLabel(dayKey) {
  const todayKey = localDayKey(new Date().toISOString());
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const yestKey = localDayKey(yest.toISOString());
  if (dayKey === todayKey) return "Today";
  if (dayKey === yestKey) return "Yesterday";
  // e.g. "Mon, 3 Aug 2026"
  const d = new Date(dayKey + "T12:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

export function timeLabel(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// Fetch meals newer than or equal to `boundaryIso`, paging until covered.
// Returns { meals, done } — `done` false only if we stopped early (shouldn't happen
// for day boundaries, but guards against runaway loops).
export async function fetchMealsSince(boundaryIso, pageSize = 50, maxPages = 20) {
  let collected = [];
  let before = null;
  for (let page = 0; page < maxPages; page++) {
    const opts = { limit: pageSize };
    if (before) opts.before = before;
    const data = await api.getMeals(opts);
    const meals = data.meals || [];
    collected = collected.concat(meals);
    // Stop once the oldest fetched meal is older than the boundary, or no more pages.
    const oldest = meals.length ? meals[meals.length - 1].timestamp : null;
    if (!data.hasMore || !oldest || oldest < boundaryIso) {
      return { meals: collected.filter((m) => m.timestamp >= boundaryIso), done: true };
    }
    before = data.nextBefore;
  }
  return { meals: collected.filter((m) => m.timestamp >= boundaryIso), done: false };
}

// Today's meals (whole day), newest first.
export function todaysMeals(allSinceToday) {
  return allSinceToday; // fetchMealsSince(startOfTodayIso()) already bounds to today
}

// Group meals (already newest-first) into [{ dayKey, label, meals: [...] }, ...].
export function groupByDay(meals) {
  const groups = [];
  const index = new Map();
  meals.forEach((m) => {
    const key = localDayKey(m.timestamp);
    let g = index.get(key);
    if (!g) {
      g = { dayKey: key, label: dayLabel(key), meals: [] };
      index.set(key, g);
      groups.push(g);
    }
    g.meals.push(m);
  });
  return groups;
}

// The ~n most frequently used foods across the given meals, most frequent first.
// Returns [{ food_id, name, count }].
export function frequentFoods(meals, n = 8) {
  const counts = new Map();
  meals.forEach((m) => (m.items || []).forEach((it) => {
    if (!it.food_id) return;
    const cur = counts.get(it.food_id) || { food_id: it.food_id, name: it.name, count: 0 };
    cur.count += 1;
    cur.name = it.name; // keep latest name
    counts.set(it.food_id, cur);
  }));
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

// The ~n most frequently used exercises across the given workouts, most frequent first.
// Returns [{ exercise_id, name, count }]. Mirrors frequentFoods (groupByDay/timeLabel are
// already generic over any timestamped items, so they're reused as-is for workouts).
export function frequentExercises(workouts, n = 8) {
  const counts = new Map();
  workouts.forEach((w) => (w.items || []).forEach((it) => {
    if (!it.exercise_id) return;
    const cur = counts.get(it.exercise_id) || { exercise_id: it.exercise_id, name: it.name, count: 0 };
    cur.count += 1;
    cur.name = it.name; // keep latest name
    counts.set(it.exercise_id, cur);
  }));
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}
