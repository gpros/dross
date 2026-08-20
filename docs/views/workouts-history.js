// views/workouts-history.js — reverse-chronological workouts grouped by day. Each day header
// shows a simple count (exercises · sets) — no targets. Paginated. Mirror of views/history.js.

import * as state from "../state.js";
import * as api from "../api.js";
import { el, clear, formatNum } from "../ui.js";
import { groupByDay, timeLabel } from "../meals.js";
import { openWorkoutEditor } from "../editors.js";

const PAGE_SIZE = 20;

export function createWorkoutsHistoryView(ctx) {
  const root = document.getElementById("view-workouts");
  let loading = false;
  let loadError = false;

  // A short summary of one logged exercise, e.g. "3 × 12 · 20 kg · 30 min".
  function itemSummary(it) {
    const parts = [];
    if (it.sets != null && it.reps != null) parts.push(`${formatNum(it.sets)} × ${formatNum(it.reps)}`);
    else if (it.reps != null) parts.push(`${formatNum(it.reps)} reps`);
    else if (it.sets != null) parts.push(`${formatNum(it.sets)} sets`);
    if (it.weight != null) parts.push(`${formatNum(it.weight)} kg`);
    if (it.duration_min != null) parts.push(`${formatNum(it.duration_min)} min`);
    return parts.join(" · ");
  }

  // Day header line: total exercises and total sets across the day's workouts.
  function daySummary(workouts) {
    let exercises = 0, sets = 0;
    workouts.forEach((w) => (w.items || []).forEach((it) => {
      exercises += 1;
      sets += Number(it.sets) || 0;
    }));
    return `${exercises} exercise${exercises === 1 ? "" : "s"} · ${formatNum(sets)} set${sets === 1 ? "" : "s"}`;
  }

  function renderWorkout(workout) {
    const itemsList = el("ul", { class: "meal-items items" });
    (workout.items || []).forEach((it) => {
      itemsList.appendChild(
        el("li", { class: "item" }, [
          el("span", { class: "name", text: it.name }),
          el("span", { class: "unit", text: itemSummary(it) }),
        ])
      );
    });

    const children = [
      el("div", {}, [
        el("span", { class: "meal-kcal", text: `${(workout.items || []).length} exercise${(workout.items || []).length === 1 ? "" : "s"}` }),
        el("span", { class: "meal-time", text: timeLabel(workout.timestamp) + "  ✎" }),
      ]),
      itemsList,
    ];
    if (workout.note) children.push(el("div", { class: "meal-note", text: workout.note }));
    return el("div", {
      class: "meal editable",
      role: "button",
      "aria-label": "Edit workout",
      onclick: () => openWorkoutEditor(workout, { onSaved: renderView, onDeleted: renderView }),
    }, children);
  }

  function renderView() {
    clear(root);
    const workouts = state.getRecentWorkouts();

    if (loadError && !workouts.length) {
      root.appendChild(el("div", { class: "error" }, [
        "Couldn't load history. ",
        el("button", { class: "btn small", text: "Retry", onclick: () => show() }),
      ]));
      return;
    }

    if (!workouts.length) {
      root.appendChild(el("div", { class: "empty", text: "No workouts logged yet." }));
      return;
    }

    // groupByDay is generic over timestamped items; g.meals holds this day's workouts.
    const groups = groupByDay(workouts);
    groups.forEach((g) => {
      const header = el("div", { class: "day-header" }, [
        el("div", { class: "day-title", text: g.label }),
        el("div", { class: "muted small", text: daySummary(g.meals) }),
      ]);
      const nodes = g.meals.map(renderWorkout);
      root.appendChild(el("div", { class: "day-group card" }, [header, ...nodes]));
    });

    if (state.getWorkoutsHasMore()) {
      const moreBtn = el("button", {
        class: "btn block", text: loading ? "Loading…" : "Load more",
        onclick: () => loadMore(moreBtn),
      });
      moreBtn.disabled = loading;
      root.appendChild(moreBtn);
    }
  }

  async function loadMore(btn) {
    if (loading || !state.getWorkoutsHasMore()) return;
    loading = true;
    loadError = false;
    if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }
    try {
      const data = await api.getWorkouts({ limit: PAGE_SIZE, before: state.getWorkoutsNextBefore() });
      state.appendOlderWorkouts(data.workouts || [], data.hasMore, data.nextBefore);
    } catch (err) {
      loadError = true;
    } finally {
      loading = false;
      renderView();
    }
  }

  // Renders from the shared cache — workouts were loaded once at startup via getBootstrap.
  function show() {
    renderView();
  }

  return { show };
}
