// views/dishes.js — the Dishes tab: create and edit recipes (dishes) composed from foods.
// A dish's nutrition is computed client-side (see state.recomputeDishes) and it also appears
// in the Log food search like any food.

import * as state from "../state.js";
import { el, clear, formatNum, displayName } from "../ui.js";
import { itemsTotals } from "../nutrition.js";
import { openDishEditor } from "../editors.js";

export function createDishesView(ctx) {
  const root = document.getElementById("view-dishes");   // list (scrolls in the popup body)
  let controlsHost = null;                               // popup bottom bar (title + New dish)

  function summaryLine(dish) {
    // Per-serving if servings set, else whole-dish totals.
    const totals = itemsTotals(state.getRecipe(dish.id));
    const geq = (m) => (totals.incomplete[m] ? "≥" : "");
    const f = dish.servings > 0 ? 1 / dish.servings : 1;
    const label = dish.servings > 0 ? `per serving (${formatNum(dish.servings)})` : "whole dish";
    return `${geq("kcal")}${formatNum(totals.kcal * f)} kcal · P ${geq("protein")}${formatNum(totals.protein * f, 1)} · ` +
      `C ${geq("carbs")}${formatNum(totals.carbs * f, 1)} · F ${geq("fat")}${formatNum(totals.fat * f, 1)} g · ${label}`;
  }

  // Controls live in the popup's fixed bottom bar (title + New dish + hint).
  function renderControls() {
    if (!controlsHost) return;
    clear(controlsHost);
    const addBtn = el("button", {
      class: "btn small primary", text: "+ New dish",
      onclick: () => openDishEditor(null, { onSaved: render }),
    });
    controlsHost.append(
      el("div", { class: "row between" }, [el("div", { class: "section-title", text: "Dishes" }), addBtn]),
      el("p", { class: "muted small", text: "Recipes built from foods. They appear in the Log search like any food." }),
    );
  }

  function renderListBody() {
    clear(root);
    const dishes = state.getDishes();
    if (!dishes.length) {
      root.appendChild(el("div", { class: "empty", text: "No dishes yet. Tap “+ New dish” to build one." }));
      return;
    }
    const list = el("div", {});
    dishes.forEach((dish) => {
      list.appendChild(el("button", {
        class: "food-row", onclick: () => openDishEditor(dish, { onSaved: render }),
      }, [
        el("span", { class: "fname", text: "🍲 " + displayName(dish) }),
        el("span", { class: "fmacros", text: summaryLine(dish) }),
      ]));
    });
    root.appendChild(el("div", { class: "card" }, [list]));
  }

  function render() {
    renderListBody();
    renderControls();
  }

  function show(opts = {}, host) {
    if (host) controlsHost = host;
    render();
  }

  return { show };
}
