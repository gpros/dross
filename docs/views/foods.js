// views/foods.js — the personal food catalog: searchable list, missing-data marker,
// add, and inline edit.

import * as state from "../state.js";
import { el, clear, normalizeText, formatNum } from "../ui.js";
import { openFoodEditor } from "../editors.js";

const NUTRIENTS = ["kcal_100g", "protein_100g", "carbs_100g", "fat_100g"];

function foodIsIncomplete(food) {
  return NUTRIENTS.some((k) => food[k] == null);
}

export function createFoodsView(ctx) {
  const root = document.getElementById("view-foods");
  let query = "";
  let incompleteOnly = false;
  let loadError = false;

  function macrosLine(food) {
    const fmt = (v, unit) => (v == null ? "—" : formatNum(v) + unit);
    return `${fmt(food.kcal_100g, "")} kcal · P ${fmt(food.protein_100g, "")} · C ${fmt(food.carbs_100g, "")} · F ${fmt(food.fat_100g, "")} /100g`;
  }

  function renderList(listEl) {
    clear(listEl);
    const q = normalizeText(query);
    let foods = state.getFoods();
    if (q) foods = foods.filter((f) => normalizeText(f.name).includes(q));
    if (incompleteOnly) foods = foods.filter(foodIsIncomplete);

    if (!foods.length) {
      listEl.appendChild(el("p", { class: "empty", text: state.getFoods().length ? "No matching foods." : "No foods yet. Add one to get started." }));
      return;
    }

    foods.forEach((food) => {
      const incomplete = foodIsIncomplete(food);
      const row = el("button", {
        class: "food-row",
        onclick: () => openFoodEditor(food, { onSaved: () => renderList(listEl) }),
      }, [
        incomplete ? el("span", { class: "incomplete-dot", title: "Missing nutrition data" }) : el("span", { style: "width:8px" }),
        el("span", { class: "fname", text: food.name }),
        el("span", { class: "fmacros", text: macrosLine(food) }),
      ]);
      listEl.appendChild(row);
    });
  }

  function renderView() {
    clear(root);

    const searchInput = el("input", {
      type: "search", placeholder: "Search foods…", value: query, autocomplete: "off",
    });
    const listEl = el("div", { class: "food-list" });
    searchInput.addEventListener("input", () => { query = searchInput.value; renderList(listEl); });

    const toggle = el("label", { class: "filter-toggle" }, [
      (() => {
        const cb = el("input", { type: "checkbox" });
        cb.checked = incompleteOnly;
        cb.addEventListener("change", () => { incompleteOnly = cb.checked; renderList(listEl); });
        return cb;
      })(),
      el("span", { text: "Missing data only" }),
    ]);

    const addBtn = el("button", {
      class: "btn small primary", text: "+ Add food",
      onclick: () => openFoodEditor(null, { onSaved: () => renderList(listEl) }),
    });

    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "row between" }, [
        el("div", { class: "section-title", text: "Foods" }),
        addBtn,
      ]),
      searchInput,
      el("div", { class: "row between", style: "margin-top:10px" }, [toggle, el("span", {})]),
    ]));

    if (loadError) {
      root.appendChild(el("div", { class: "error" }, [
        "Couldn't load foods. ",
        el("button", { class: "btn small", text: "Retry", onclick: () => show() }),
      ]));
    }

    root.appendChild(el("div", { class: "card" }, [listEl]));
    renderList(listEl);
  }

  async function show(opts = {}) {
    // Deep-link from the summary's missing-data warning.
    if (opts.filterIncomplete) incompleteOnly = true;

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
