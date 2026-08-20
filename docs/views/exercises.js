// views/exercises.js — the personal exercise catalog: searchable list, add, and inline edit.
// Mirror of views/foods.js (exercises have no "missing macros" concept, so no incomplete filter).

import * as state from "../state.js";
import { el, clear, normalizeText, formatNum, matchingName, foodMatchesQuery } from "../ui.js";
import { openExerciseEditor } from "../editors.js";

// A short summary of an exercise's defaults, e.g. "3 × 12 · 20 kg · 30 min", or "No defaults".
function defaultsLine(ex) {
  const parts = [];
  if (ex.default_sets != null && ex.default_reps != null) parts.push(`${formatNum(ex.default_sets)} × ${formatNum(ex.default_reps)}`);
  else if (ex.default_reps != null) parts.push(`${formatNum(ex.default_reps)} reps`);
  else if (ex.default_sets != null) parts.push(`${formatNum(ex.default_sets)} sets`);
  if (ex.default_weight != null) parts.push(`${formatNum(ex.default_weight)} kg`);
  if (ex.default_duration_min != null) parts.push(`${formatNum(ex.default_duration_min)} min`);
  return parts.length ? parts.join(" · ") : "No defaults";
}

export function createExercisesView(ctx) {
  const root = document.getElementById("view-exercises");   // list (scrolls in the popup body)
  let controlsHost = null;                                  // popup bottom bar (search / add)
  let listEl = null;
  let query = "";
  let loadError = false;

  function renderList() {
    if (!listEl) return;
    clear(listEl);
    const q = normalizeText(query);
    let exercises = state.getExercises();
    if (q) exercises = exercises.filter((e) => foodMatchesQuery(e, q));

    if (!exercises.length) {
      listEl.appendChild(el("p", { class: "empty", text: state.getExercises().length ? "No matching exercises." : "No exercises yet. Add one to get started." }));
      return;
    }

    exercises.forEach((ex) => {
      const row = el("button", {
        class: "food-row",
        onclick: () => openExerciseEditor(ex, { onSaved: renderList }),
      }, [
        el("span", { style: "width:8px" }),
        el("span", { class: "fname", text: matchingName(ex, q) }),
        el("span", { class: "fmacros", text: defaultsLine(ex) }),
      ]);
      listEl.appendChild(row);
    });
  }

  // Controls live in the popup's fixed bottom bar (search, + Add exercise).
  function renderControls() {
    if (!controlsHost) return;
    clear(controlsHost);

    const searchInput = el("input", {
      type: "search", placeholder: "Search exercises…", value: query, autocomplete: "off",
    });
    searchInput.addEventListener("input", () => { query = searchInput.value; renderList(); });

    const addBtn = el("button", {
      class: "btn small primary", text: "+ Add exercise",
      onclick: () => openExerciseEditor(null, { onSaved: renderList }),
    });

    controlsHost.append(
      el("div", { class: "row between" }, [el("div", { class: "section-title", text: "Exercises" }), addBtn]),
      searchInput,
    );
  }

  function renderView() {
    clear(root);
    listEl = el("div", { class: "food-list" });
    if (loadError) {
      root.appendChild(el("div", { class: "error" }, [
        "Couldn't load exercises. ",
        el("button", { class: "btn small", text: "Retry", onclick: () => show() }),
      ]));
    }
    root.appendChild(listEl); // no card box — just the rows with their separators
    renderList();
    renderControls();
  }

  async function show(opts = {}, host) {
    if (host) controlsHost = host;
    clear(root);
    root.appendChild(el("div", { class: "loading", text: "Loading…" }));
    loadError = false;
    try {
      await state.loadExercises();
    } catch (err) {
      loadError = true;
    }
    renderView();
  }

  return { show };
}
