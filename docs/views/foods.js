// views/foods.js — the personal food catalog: searchable list, missing-data marker,
// add, and inline edit.

import * as state from "../state.js";
import { el, clear, normalizeText, formatNum, matchingName, foodMatchesQuery } from "../ui.js";
import { openFoodEditor } from "../editors.js";

const NUTRIENTS = ["kcal_100g", "protein_100g", "carbs_100g", "fat_100g"];

function foodIsIncomplete(food) {
  return NUTRIENTS.some((k) => food[k] == null);
}

export function createFoodsView(ctx) {
  const root = document.getElementById("view-foods");   // list (scrolls in the popup body)
  let controlsHost = null;                              // popup bottom bar (search / add / filter)
  let listEl = null;
  let query = "";
  let incompleteOnly = false;
  let loadError = false;

  function macrosLine(food) {
    const fmt = (v, unit) => (v == null ? "—" : formatNum(v) + unit);
    const base = `${fmt(food.kcal_100g, "")} kcal · P ${fmt(food.protein_100g, "")} · C ${fmt(food.carbs_100g, "")} · F ${fmt(food.fat_100g, "")} /100g`;
    return food.serving_g != null ? `${base} · serv ${formatNum(food.serving_g)} g` : base;
  }

  function renderList() {
    if (!listEl) return;
    clear(listEl);
    const q = normalizeText(query);
    let foods = state.getFoods().filter((f) => !f.is_dish); // dishes live in the Dishes segment
    if (q) foods = foods.filter((f) => foodMatchesQuery(f, q));
    if (incompleteOnly) foods = foods.filter(foodIsIncomplete);

    if (!foods.length) {
      listEl.appendChild(el("p", { class: "empty", text: state.getFoods().length ? "No matching foods." : "No foods yet. Add one to get started." }));
      return;
    }

    foods.forEach((food) => {
      const incomplete = foodIsIncomplete(food);
      const row = el("button", {
        class: "food-row",
        onclick: () => openFoodEditor(food, { onSaved: renderList }),
      }, [
        incomplete ? el("span", { class: "incomplete-dot", title: "Missing nutrition data" }) : el("span", { style: "width:8px" }),
        el("span", { class: "fname", text: matchingName(food, q) }),
        el("span", { class: "fmacros", text: macrosLine(food) }),
      ]);
      listEl.appendChild(row);
    });
  }

  // Controls live in the popup's fixed bottom bar (search, + Add food, Missing-data filter).
  function renderControls() {
    if (!controlsHost) return;
    clear(controlsHost);

    const searchInput = el("input", {
      type: "search", placeholder: "Search foods…", value: query, autocomplete: "off",
    });
    searchInput.addEventListener("input", () => { query = searchInput.value; renderList(); });

    const cb = el("input", { type: "checkbox" });
    cb.checked = incompleteOnly;
    cb.addEventListener("change", () => { incompleteOnly = cb.checked; renderList(); });
    const toggle = el("label", { class: "filter-toggle" }, [cb, el("span", { text: "Missing data only" })]);

    const addBtn = el("button", {
      class: "btn small primary", text: "+ Add food",
      onclick: () => openFoodEditor(null, { onSaved: renderList }),
    });

    controlsHost.append(
      el("div", { class: "row between" }, [el("div", { class: "section-title", text: "Foods" }), addBtn]),
      searchInput,
      el("div", { class: "row between", style: "margin-top:10px" }, [toggle, el("span", {})]),
    );
  }

  function renderView() {
    clear(root);
    listEl = el("div", { class: "food-list" });
    if (loadError) {
      root.appendChild(el("div", { class: "error" }, [
        "Couldn't load foods. ",
        el("button", { class: "btn small", text: "Retry", onclick: () => show() }),
      ]));
    }
    root.appendChild(el("div", { class: "card" }, [listEl]));
    renderList();
    renderControls();
  }

  async function show(opts = {}, host) {
    if (host) controlsHost = host;
    // Deep-link from the summary's missing-data warning.
    if (opts && opts.filterIncomplete) incompleteOnly = true;

    clear(root);
    root.appendChild(el("div", { class: "loading", text: "Loading…" }));
    loadError = false;
    try {
      await state.loadFoods();
    } catch (err) {
      loadError = true;
    }
    renderView();
  }

  return { show };
}
