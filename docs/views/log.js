// views/log.js — the Log view: today summary, food search, quick-picks, draft meal,
// repeat-last-meal, and save. Optimized for fast entry.

import * as state from "../state.js";
import * as api from "../api.js";
import {
  el, clear, toast, normalizeText, renderTargetBars, formatNum,
  displayName, matchingName, foodMatchesQuery, foodMatchesExact,
} from "../ui.js";
import { itemsTotals, mealsTotals, combineTotals } from "../nutrition.js";
import { openTargetsEditor, promptQuantity } from "../editors.js";
import { localDayKey, frequentFoods } from "../meals.js";

export function createLogView(ctx) {
  const root = document.getElementById("view-log");

  let todaysMeals = [];   // saved meals for today (whole-day boundary)
  let recentMeals = [];   // a page of recent meals for quick-picks / repeat
  let loadError = false;
  let loadedVersion = -1; // meals version this view last fetched (see state.getMealsVersion)

  // Sub-containers we re-render independently.
  let summaryBox, searchInput, resultsEl, chipsEl, itemsEl, saveBtn;

  function todayTotals() {
    return mealsTotals(todaysMeals);
  }
  function draftTotals() {
    return itemsTotals(state.getDraft().items);
  }

  // ---- Summary (re-rendered live as the draft changes) ----
  function renderSummary() {
    clear(summaryBox);
    const combined = combineTotals(todayTotals(), draftTotals());
    const hasDraft = !state.draftIsEmpty();
    summaryBox.appendChild(
      renderTargetBars(combined, state.getSettings(), {
        provisional: hasDraft,
        onEditTargets: () => openTargetsEditor({ onSaved: () => renderSummary() }),
        onMissingClick: () => ctx.navigate("foods", { filterIncomplete: true }),
      })
    );
  }

  // ---- Draft item list ----
  function renderItems() {
    clear(itemsEl);
    const draft = state.getDraft();
    if (!draft.items.length) {
      itemsEl.appendChild(el("p", { class: "muted small", text: "No items yet. Search or tap a chip to add." }));
      saveBtn.disabled = true;
      return;
    }
    saveBtn.disabled = false;
    draft.items.forEach((item, idx) => {
      const qtyInput = el("input", {
        class: "qty-input", type: "text", inputmode: "decimal", value: String(item.quantity_g),
        "aria-label": "Quantity in grams for " + item.name,
      });
      qtyInput.addEventListener("change", () => {
        const v = Number(String(qtyInput.value).replace(",", "."));
        if (isNaN(v) || v <= 0) { qtyInput.value = String(item.quantity_g); return; }
        state.updateDraftItemQty(idx, v);
        renderSummary();
      });
      itemsEl.appendChild(
        el("li", { class: "item" }, [
          el("span", { class: "name", text: item.name }),
          qtyInput,
          el("span", { class: "unit", text: "g" }),
          el("button", {
            class: "iconbtn", "aria-label": "Remove " + item.name, text: "✕",
            onclick: () => { state.removeDraftItem(idx); renderItems(); renderSummary(); },
          }),
        ])
      );
    });
  }

  // ---- Add-to-draft helpers ----
  async function addFoodToDraft(food) {
    const qty = await promptQuantity(food); // pass the food so serving chips can show
    if (qty == null) return;
    state.addDraftItem({ food_id: food.id, name: displayName(food), quantity_g: qty });
    searchInput.value = "";
    renderResults("");
    renderItems();
    renderSummary();
  }

  async function addNewFoodToDraft(typedName) {
    const qty = await promptQuantity({ name: typedName.trim() });
    if (qty == null) return;
    // No food_id yet — it will be created server-side on save (blank nutrition).
    state.addDraftItem({ food_name: typedName.trim(), name: typedName.trim(), quantity_g: qty });
    searchInput.value = "";
    renderResults("");
    renderItems();
    renderSummary();
  }

  // ---- Search results ----
  function renderResults(query) {
    clear(resultsEl);
    const q = normalizeText(query);
    if (!q) return;

    const foods = state.getFoods();
    const matches = foods
      .filter((f) => foodMatchesQuery(f, q))
      .slice(0, 8);

    const exact = foods.some((f) => foodMatchesExact(f, q));

    // "Add new" first if no exact match.
    if (!exact) {
      resultsEl.appendChild(
        el("li", { class: "add-new", onclick: () => addNewFoodToDraft(query) }, [
          el("span", { text: `Add “${query.trim()}” as new food` }),
          el("span", { class: "meta", text: "new" }),
        ])
      );
    }

    matches.forEach((f) => {
      const kcal = f.kcal_100g == null ? "—" : formatNum(f.kcal_100g) + " kcal/100g";
      resultsEl.appendChild(
        el("li", { onclick: () => addFoodToDraft(f) }, [
          el("span", { text: (f.is_dish ? "🍲 " : "") + matchingName(f, q) }),
          el("span", { class: "meta", text: kcal }),
        ])
      );
    });
  }

  // ---- Quick-pick chips ----
  function renderChips() {
    clear(chipsEl);
    const freq = frequentFoods(recentMeals, 8);
    if (!freq.length) { chipsEl.appendChild(el("span", { class: "muted small", text: "Quick picks appear as you log meals." })); return; }
    freq.forEach((f) => {
      const food = state.getFoodById(f.food_id) || { id: f.food_id, name: f.name };
      chipsEl.appendChild(
        el("button", { class: "chip", text: displayName(food), onclick: () => addFoodToDraft(food) })
      );
    });
  }

  // ---- Repeat last meal ----
  function repeatLastMeal() {
    const last = recentMeals[0];
    if (!last || !last.items.length) { toast("No previous meal to repeat."); return; }
    last.items.forEach((it) => {
      state.addDraftItem({ food_id: it.food_id, name: it.name, quantity_g: it.quantity_g });
    });
    renderItems();
    renderSummary();
    toast("Added items from your last meal");
  }

  // ---- Save ----
  async function saveMeal(dateInput, noteInput) {
    const draft = state.getDraft();
    if (!draft.items.length) return;

    // Convert the datetime-local value to an ISO string with the local offset.
    let iso = draft.timestamp;
    if (dateInput.value) iso = state.toLocalIso(new Date(dateInput.value));
    const note = noteInput.value.trim();

    const items = draft.items.map((it) =>
      it.food_id
        ? { food_id: it.food_id, quantity_g: it.quantity_g }
        : { food_name: it.name, quantity_g: it.quantity_g }
    );

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      const created = await api.addMeal({ timestamp: iso, note, items });
      state.prependMeal(created); // add to the shared cache + bump version (no refetch)
      // A brand-new food may have been created — refresh the catalog.
      const hadNew = draft.items.some((it) => !it.food_id);
      if (hadNew) { try { await state.loadFoods(true); } catch (_) {} }

      state.resetDraft();
      toast("Meal logged");
      reloadMealData();           // re-derive today + recent from the updated cache
      renderView();               // full re-render resets the form
    } catch (err) {
      // Keep everything on screen; let the user retry.
      saveBtn.disabled = false;
      saveBtn.textContent = "Save meal";
      toast(err.message || "Could not save. Your meal is kept — tap Save to retry.", { error: true });
    }
  }

  // ---- Data (derived from the shared cache loaded once at startup) ----
  function reloadMealData() {
    recentMeals = state.getRecentMeals();
    const todayKey = localDayKey(new Date().toISOString());
    todaysMeals = recentMeals.filter((m) => localDayKey(m.timestamp) === todayKey);
    loadedVersion = state.getMealsVersion();
    loadError = false;
  }

  // ---- Full render ----
  function renderView() {
    clear(root);

    // Summary card.
    summaryBox = el("div", {});
    root.appendChild(el("div", { class: "card" }, [summaryBox]));

    // Entry card.
    const now = new Date();
    const dateInput = el("input", {
      type: "datetime-local",
      value: localInputValue(state.getDraft().timestamp ? new Date(state.getDraft().timestamp) : now),
    });
    dateInput.addEventListener("change", () => {
      if (dateInput.value) state.setDraftTimestamp(state.toLocalIso(new Date(dateInput.value)));
    });

    searchInput = el("input", { type: "search", placeholder: "Search or add a food…", autocomplete: "off", enterkeyhint: "search" });
    resultsEl = el("ul", { class: "results" });
    searchInput.addEventListener("input", () => renderResults(searchInput.value));

    chipsEl = el("div", { class: "chips" });
    itemsEl = el("ul", { class: "items" });
    const noteInput = el("input", { type: "text", placeholder: "Note (optional)", value: state.getDraft().note || "" });
    noteInput.addEventListener("input", () => state.setDraftNote(noteInput.value));

    saveBtn = el("button", { class: "btn primary block", text: "Save meal" });
    saveBtn.addEventListener("click", () => saveMeal(dateInput, noteInput));

    const repeatBtn = el("button", { class: "btn small ghost", text: "↻ Repeat last meal", onclick: repeatLastMeal });

    const entryCard = el("div", { class: "card" }, [
      el("label", { class: "field" }, [el("span", { text: "When" }), dateInput]),
      el("label", { class: "field" }, [el("span", { text: "Add food" }), searchInput]),
      resultsEl,
      el("div", { class: "section-title", text: "Quick picks" }),
      chipsEl,
    ]);

    const mealCard = el("div", { class: "card" }, [
      el("div", { class: "row between" }, [
        el("div", { class: "section-title", text: "This meal" }),
        repeatBtn,
      ]),
      itemsEl,
      el("label", { class: "field", style: "margin-top:10px" }, [el("span", { text: "Note" }), noteInput]),
      saveBtn,
    ]);

    root.appendChild(entryCard);
    root.appendChild(mealCard);

    if (loadError) {
      root.insertBefore(
        el("div", { class: "error" }, [
          "Couldn't load today's data. ",
          el("button", { class: "btn small", text: "Retry", onclick: async () => { await reloadMealData(); renderView(); } }),
        ]),
        root.firstChild
      );
    }

    renderSummary();
    renderChips();
    renderItems();
  }

  // ---- Public API ----
  function show() {
    // Ensure a draft exists.
    if (!state.getDraft().timestamp) state.resetDraft();
    // Re-derive from the shared cache only when meals changed since last render (a saved
    // meal bumps the version). No network here — everything was loaded once at startup.
    if (loadedVersion !== state.getMealsVersion()) reloadMealData();
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
