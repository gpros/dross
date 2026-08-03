// views/history.js — reverse-chronological meals grouped by day. Each day header shows
// that day's totals vs. targets (reusing the shared summary component). Paginated.

import * as state from "../state.js";
import * as api from "../api.js";
import { el, clear, renderTargetBars } from "../ui.js";
import { mealsTotals, itemsTotals } from "../nutrition.js";
import { groupByDay, timeLabel } from "../meals.js";

const PAGE_SIZE = 20;

export function createHistoryView(ctx) {
  const root = document.getElementById("view-history");
  let meals = [];
  let hasMore = false;
  let nextBefore = null;
  let loading = false;
  let loadError = false;

  function mealKcal(meal) {
    const t = itemsTotals(meal.items);
    const geq = t.incomplete.kcal ? "≥" : "";
    return geq + Math.round(t.kcal) + " kcal";
  }

  function renderMeal(meal) {
    const itemsList = el("ul", { class: "meal-items items" });
    (meal.items || []).forEach((it) => {
      itemsList.appendChild(
        el("li", { class: "item" }, [
          el("span", { class: "name", text: it.name }),
          el("span", { class: "unit", text: `${it.quantity_g} g` }),
        ])
      );
    });

    const children = [
      el("div", {}, [
        el("span", { class: "meal-kcal", text: mealKcal(meal) }),
        el("span", { class: "meal-time", text: timeLabel(meal.timestamp) }),
      ]),
      itemsList,
    ];
    if (meal.note) children.push(el("div", { class: "meal-note", text: meal.note }));
    return el("div", { class: "meal" }, children);
  }

  function renderView() {
    clear(root);

    if (loadError && !meals.length) {
      root.appendChild(el("div", { class: "error" }, [
        "Couldn't load history. ",
        el("button", { class: "btn small", text: "Retry", onclick: () => show() }),
      ]));
      return;
    }

    if (!meals.length) {
      root.appendChild(el("div", { class: "empty", text: "No meals logged yet." }));
      return;
    }

    const groups = groupByDay(meals);
    groups.forEach((g) => {
      const dayTotals = mealsTotals(g.meals);
      const header = el("div", { class: "day-header" }, [
        el("div", { class: "day-title", text: g.label }),
        renderTargetBars(dayTotals, state.getSettings(), { compact: true }),
      ]);
      const mealNodes = g.meals.map(renderMeal);
      root.appendChild(el("div", { class: "day-group card" }, [header, ...mealNodes]));
    });

    if (hasMore) {
      const moreBtn = el("button", {
        class: "btn block", text: loading ? "Loading…" : "Load more",
        onclick: () => loadMore(moreBtn),
      });
      moreBtn.disabled = loading;
      root.appendChild(moreBtn);
    }
  }

  async function loadMore(btn) {
    if (loading || !hasMore) return;
    loading = true;
    if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }
    try {
      const data = await api.getMeals({ limit: PAGE_SIZE, before: nextBefore });
      meals = meals.concat(data.meals || []);
      hasMore = !!data.hasMore;
      nextBefore = data.nextBefore;
    } catch (err) {
      loadError = true;
    } finally {
      loading = false;
      renderView();
    }
  }

  async function show() {
    clear(root);
    root.appendChild(el("div", { class: "loading", text: "Loading…" }));
    meals = [];
    hasMore = false;
    nextBefore = null;
    loadError = false;
    try {
      // Ensure settings + catalog are available for day headers and totals.
      await Promise.all([state.loadSettings(), state.loadFoods()]);
      const data = await api.getMeals({ limit: PAGE_SIZE });
      meals = data.meals || [];
      hasMore = !!data.hasMore;
      nextBefore = data.nextBefore;
    } catch (err) {
      loadError = true;
    }
    renderView();
  }

  return { show };
}
