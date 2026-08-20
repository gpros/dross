// views/exercise-log.js — the Exercise Log view: exercise search, quick-picks, the draft
// workout (each exercise with reps/sets/weight/duration), repeat-last-workout, and save.
// Mirror of views/log.js, minus the nutrition summary card (exercise has no daily targets).

import * as state from "../state.js";
import * as api from "../api.js";
import { el, clear, toast, normalizeText, displayName, matchingName, foodMatchesQuery, foodMatchesExact } from "../ui.js";
import { promptExerciseSet, exerciseSetFields } from "../editors.js";
import { frequentExercises } from "../meals.js";

export function createExerciseLogView(ctx) {
  const root = document.getElementById("view-exercise-log");

  let recentWorkouts = [];  // a page of recent workouts for quick-picks / repeat
  let loadedVersion = -1;   // workouts version this view last derived (see state.getWorkoutsVersion)

  // Sub-containers we re-render independently.
  let searchInput, resultsEl, chipsEl, itemsEl, saveBtn;

  // ---- Draft item list ----
  function renderItems() {
    clear(itemsEl);
    const draft = state.getExerciseDraft();
    if (!draft.items.length) {
      itemsEl.appendChild(el("p", { class: "muted small", text: "No exercises yet. Search or tap a chip to add." }));
      if (saveBtn) saveBtn.disabled = true;
      return;
    }
    if (saveBtn) saveBtn.disabled = false;
    draft.items.forEach((item, idx) => {
      itemsEl.appendChild(
        el("li", { class: "item exercise-item" }, [
          el("div", { class: "row between" }, [
            el("span", { class: "name", text: item.name }),
            el("button", {
              class: "iconbtn", "aria-label": "Remove " + item.name, text: "✕",
              onclick: () => { state.removeExerciseDraftItem(idx); renderItems(); },
            }),
          ]),
          exerciseSetFields(item), // edits the draft item in place
        ])
      );
    });
  }

  // ---- Add-to-draft helpers ----
  async function addExerciseToDraft(exercise) {
    const set = await promptExerciseSet(exercise);
    if (set == null) return;
    state.addExerciseDraftItem({ exercise_id: exercise.id, name: displayName(exercise), ...set });
    searchInput.value = "";
    renderResults("");
    renderItems();
  }

  async function addNewExerciseToDraft(typedName) {
    const set = await promptExerciseSet(typedName.trim());
    if (set == null) return;
    // No exercise_id yet — it will be created server-side on save.
    state.addExerciseDraftItem({ exercise_name: typedName.trim(), name: typedName.trim(), ...set });
    searchInput.value = "";
    renderResults("");
    renderItems();
  }

  // ---- Search results ----
  function renderResults(query) {
    clear(resultsEl);
    const q = normalizeText(query);
    if (!q) return;

    const exercises = state.getExercises();
    const matches = exercises.filter((e) => foodMatchesQuery(e, q)).slice(0, 8);
    const exact = exercises.some((e) => foodMatchesExact(e, q));

    if (!exact) {
      resultsEl.appendChild(
        el("li", { class: "add-new", onclick: () => addNewExerciseToDraft(query) }, [
          el("span", { text: `Add “${query.trim()}” as new exercise` }),
          el("span", { class: "meta", text: "new" }),
        ])
      );
    }

    matches.forEach((e) => {
      resultsEl.appendChild(
        el("li", { onclick: () => addExerciseToDraft(e) }, [
          el("span", { text: matchingName(e, q) }),
        ])
      );
    });
  }

  // ---- Quick-pick chips ----
  function renderChips() {
    clear(chipsEl);
    const freq = frequentExercises(recentWorkouts, 8);
    if (!freq.length) { chipsEl.appendChild(el("span", { class: "muted small", text: "Quick picks appear as you log workouts." })); return; }
    freq.forEach((f) => {
      const exercise = state.getExerciseById(f.exercise_id) || { id: f.exercise_id, name: f.name };
      chipsEl.appendChild(
        el("button", { class: "chip", text: displayName(exercise), onclick: () => addExerciseToDraft(exercise) })
      );
    });
  }

  // ---- Repeat last workout ----
  function repeatLastWorkout() {
    const last = recentWorkouts[0];
    if (!last || !last.items.length) { toast("No previous workout to repeat."); return; }
    last.items.forEach((it) => {
      state.addExerciseDraftItem({
        exercise_id: it.exercise_id, name: it.name,
        reps: it.reps, sets: it.sets, weight: it.weight, duration_min: it.duration_min,
      });
    });
    renderItems();
    toast("Added exercises from your last workout");
  }

  // ---- Save ----
  async function saveWorkout(dateInput, noteInput) {
    const draft = state.getExerciseDraft();
    if (!draft.items.length) return;
    for (const it of draft.items) {
      if (!(it.reps > 0) || !(it.sets > 0)) { toast(`Set reps and sets for “${it.name}”.`, { error: true }); return; }
    }

    let iso = draft.timestamp;
    if (dateInput.value) iso = state.toLocalIso(new Date(dateInput.value));
    const note = noteInput.value.trim();

    const items = draft.items.map((it) => ({
      ...(it.exercise_id ? { exercise_id: it.exercise_id } : { exercise_name: it.name }),
      reps: it.reps, sets: it.sets, weight: it.weight ?? null, duration_min: it.duration_min ?? null,
    }));

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      const created = await api.addWorkout({ timestamp: iso, note, items });
      state.prependWorkout(created); // add to the shared cache + bump version (no refetch)
      const hadNew = draft.items.some((it) => !it.exercise_id);
      if (hadNew) { try { await state.loadExercises(true); } catch (_) {} }

      state.resetExerciseDraft();
      toast("Workout logged");
      reloadWorkoutData();
      renderView();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save workout";
      toast(err.message || "Could not save. Your workout is kept — tap Save to retry.", { error: true });
    }
  }

  // ---- Data (derived from the shared cache loaded once at startup) ----
  function reloadWorkoutData() {
    recentWorkouts = state.getRecentWorkouts();
    loadedVersion = state.getWorkoutsVersion();
  }

  // ---- Full render ----
  function renderView() {
    clear(root);

    // Top launcher row: Exercises catalog + workout History open as popups over the log.
    root.appendChild(el("div", { class: "log-nav" }, [
      el("button", { class: "btn small ghost", text: "🏋 Exercises", onclick: () => ctx.openExerciseCatalog() }),
      el("button", { class: "btn small ghost", text: "🕘 History", onclick: () => ctx.openWorkoutHistory() }),
    ]));

    const now = new Date();
    const dateInput = el("input", {
      type: "datetime-local",
      value: localInputValue(state.getExerciseDraft().timestamp ? new Date(state.getExerciseDraft().timestamp) : now),
    });
    dateInput.addEventListener("change", () => {
      if (dateInput.value) state.setExerciseDraftTimestamp(state.toLocalIso(new Date(dateInput.value)));
    });

    searchInput = el("input", { type: "search", placeholder: "Search or add an exercise…", autocomplete: "off", enterkeyhint: "search" });
    resultsEl = el("ul", { class: "results" });
    searchInput.addEventListener("input", () => renderResults(searchInput.value));

    chipsEl = el("div", { class: "chips" });
    itemsEl = el("ul", { class: "items" });
    const noteInput = el("input", { type: "text", placeholder: "Note (optional)", value: state.getExerciseDraft().note || "" });
    noteInput.addEventListener("input", () => state.setExerciseDraftNote(noteInput.value));

    saveBtn = el("button", { class: "btn primary block", text: "Save workout" });
    saveBtn.addEventListener("click", () => saveWorkout(dateInput, noteInput));

    const repeatBtn = el("button", { class: "btn small ghost", text: "↻ Repeat last workout", onclick: repeatLastWorkout });

    const entryCard = el("div", { class: "card" }, [
      el("label", { class: "field" }, [el("span", { text: "When" }), dateInput]),
      el("label", { class: "field" }, [el("span", { text: "Add exercise" }), searchInput]),
      resultsEl,
      el("div", { class: "section-title", text: "Quick picks" }),
      chipsEl,
    ]);

    const workoutCard = el("div", { class: "card" }, [
      el("div", { class: "row between" }, [
        el("div", { class: "section-title", text: "This workout" }),
        repeatBtn,
      ]),
      itemsEl,
      el("label", { class: "field", style: "margin-top:10px" }, [el("span", { text: "Note" }), noteInput]),
      saveBtn,
    ]);

    root.appendChild(entryCard);
    root.appendChild(workoutCard);

    renderChips();
    renderItems();
  }

  // ---- Public API ----
  function show() {
    if (!state.getExerciseDraft().timestamp) state.resetExerciseDraft();
    if (loadedVersion !== state.getWorkoutsVersion()) reloadWorkoutData();
    renderView();
  }

  return { show };
}

// datetime-local wants "YYYY-MM-DDTHH:MM" in local time.
function localInputValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) + ":" + pad(d.getMinutes())
  );
}
