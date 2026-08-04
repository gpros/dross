// editors.js — modal editors shared across views: daily targets, food add/edit, and
// the quantity prompt used when adding a food to a meal.

import * as api from "./api.js";
import * as state from "./state.js";
import { el, clear, openModal, closeModal, parseDecimal, toast, normalizeText, formatNum } from "./ui.js";
import { itemsTotals } from "./nutrition.js";

const NUTRIENT_FIELDS = [
  { key: "kcal_100g", label: "Calories / 100 g", unit: "kcal" },
  { key: "protein_100g", label: "Protein / 100 g", unit: "g" },
  { key: "carbs_100g", label: "Carbs / 100 g", unit: "g" },
  { key: "fat_100g", label: "Fat / 100 g", unit: "g" },
];

const TARGET_FIELDS = [
  { key: "target_kcal", label: "Daily calories", unit: "kcal" },
  { key: "target_protein_g", label: "Daily protein", unit: "g" },
  { key: "target_carbs_g", label: "Daily carbs", unit: "g" },
  { key: "target_fat_g", label: "Daily fat", unit: "g" },
];

function decimalInput(value) {
  return el("input", {
    type: "text",
    inputmode: "decimal",
    autocomplete: "off",
    value: value == null || value === "" ? "" : String(value),
  });
}

function fieldRow(labelText, unit, input) {
  return el("label", { class: "field" }, [
    el("span", { text: unit ? `${labelText} (${unit})` : labelText }),
    input,
  ]);
}

// ---- Daily targets editor ----

export function openTargetsEditor({ onSaved } = {}) {
  const settings = state.getSettings() || {};
  const inputs = {};
  const rows = TARGET_FIELDS.map((f) => {
    const inp = decimalInput(settings[f.key]);
    inputs[f.key] = inp;
    return fieldRow(f.label, f.unit, inp);
  });

  const saveBtn = el("button", { class: "btn primary", text: "Save" });
  const form = el("div", {}, [
    el("h2", { text: "Daily targets" }),
    el("p", { class: "muted small", text: "Leave a field blank to clear it. Applies to all days." }),
    ...rows,
    el("div", { class: "actions" }, [
      el("button", { class: "btn", text: "Cancel", onclick: closeModal }),
      saveBtn,
    ]),
  ]);

  saveBtn.addEventListener("click", async () => {
    const patch = {};
    for (const f of TARGET_FIELDS) {
      const v = parseDecimal(inputs[f.key].value);
      if (Number.isNaN(v)) { toast("Enter valid numbers.", { error: true }); return; }
      patch[f.key] = v; // null => clear, number => set
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      const data = await api.updateSettings(patch);
      state.setSettings(data.settings);
      closeModal();
      toast("Targets saved");
      if (onSaved) onSaved(data.settings);
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      toast(err.message || "Could not save targets.", { error: true });
    }
  });

  openModal(form);
}

// ---- Food add / edit editor ----

// food === null  -> add mode (full nutrition, all optional)
// food object    -> edit mode (prefilled; distinguishes clear vs 0)
export function openFoodEditor(food, { onSaved } = {}) {
  const isEdit = !!food;
  const nameInput = el("input", { type: "text", value: food ? food.name : "", autocomplete: "off" });
  const inputs = {};
  const rows = NUTRIENT_FIELDS.map((f) => {
    const inp = decimalInput(food ? food[f.key] : "");
    inputs[f.key] = inp;
    return fieldRow(f.label, f.unit, inp);
  });
  const servingInput = decimalInput(food ? food.serving_g : "");

  const saveBtn = el("button", { class: "btn primary", text: "Save" });
  const form = el("div", {}, [
    el("h2", { text: isEdit ? "Edit food" : "Add food" }),
    el("label", { class: "field" }, [el("span", { text: "Name" }), nameInput]),
    el("p", { class: "muted small", text: "Leave a nutrition field blank for “unknown” (different from 0)." }),
    ...rows,
    fieldRow("Default serving", "g, optional", servingInput),
    el("div", { class: "actions" }, [
      el("button", { class: "btn", text: "Cancel", onclick: closeModal }),
      saveBtn,
    ]),
  ]);

  saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) { toast("Enter a food name.", { error: true }); return; }

    const patch = { name };
    for (const f of NUTRIENT_FIELDS) {
      const v = parseDecimal(inputs[f.key].value);
      if (Number.isNaN(v)) { toast("Nutrition values must be numbers.", { error: true }); return; }
      patch[f.key] = v; // null => unknown, number => set (0 is valid)
    }
    const serv = parseDecimal(servingInput.value);
    if (Number.isNaN(serv) || (serv != null && serv <= 0)) {
      toast("Serving size must be a positive number.", { error: true }); return;
    }
    patch.serving_g = serv; // null => clear, positive number => set

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      let saved;
      if (isEdit) {
        saved = await api.updateFood({ id: food.id, ...patch });
      } else {
        saved = await api.addFood(patch);
      }
      state.upsertFood(saved);
      closeModal();
      toast(isEdit ? "Food updated" : "Food added");
      if (onSaved) onSaved(saved);
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      toast(err.message || "Could not save food.", { error: true });
    }
  });

  openModal(form);
  nameInput.focus();
}

// ---- Quantity prompt (adding a food to a meal) ----

const SERVING_MULTIPLIERS = [0.5, 1, 2, 3];

// `food` may be a food object { name, serving_g? } or a bare name string.
// Returns a Promise resolving to a positive number (grams), or null if cancelled.
export function promptQuantity(food, defaultQty = "") {
  const name = typeof food === "string" ? food : (food && food.name) || "";
  const servingG = food && typeof food === "object" ? food.serving_g : null;

  return new Promise((resolve) => {
    const input = el("input", {
      type: "text", inputmode: "decimal", autocomplete: "off",
      value: defaultQty === "" ? "" : String(defaultQty),
      placeholder: "grams",
    });
    const addBtn = el("button", { class: "btn primary", text: "Add" });

    function submit() {
      const v = parseDecimal(input.value);
      if (v == null || Number.isNaN(v) || v <= 0) {
        toast("Enter grams (a positive number).", { error: true });
        return;
      }
      closeModal();
      resolve(v);
    }
    addBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    const children = [
      el("h2", { text: name }),
      el("label", { class: "field" }, [el("span", { text: "Quantity (g)" }), input]),
    ];

    // Serving quick-picks when the food has a default serving size.
    if (servingG != null && servingG > 0) {
      const chips = SERVING_MULTIPLIERS.map((mult) => {
        const grams = Math.round(servingG * mult * 100) / 100;
        const label = (mult === 0.5 ? "½" : String(mult)) + " serv · " + grams + " g";
        return el("button", {
          class: "chip", type: "button", text: label,
          onclick: () => { input.value = String(grams); },
        });
      });
      children.push(el("div", { class: "muted small", text: `1 serving = ${servingG} g` }));
      children.push(el("div", { class: "chips" }, chips));
    }

    children.push(el("div", { class: "actions" }, [
      el("button", { class: "btn", text: "Cancel", onclick: () => { closeModal(); resolve(null); } }),
      addBtn,
    ]));

    openModal(el("div", {}, children));
    input.focus();
  });
}

// ---- Meal editor (edit / delete a logged meal, from History) ----

function toLocalInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) + ":" + pad(d.getMinutes())
  );
}

// meal: { id, timestamp, note, items:[{food_id, name, quantity_g}] }
export function openMealEditor(meal, { onSaved, onDeleted } = {}) {
  // Working copy of items (edited in place; grams are strings while editing).
  const items = (meal.items || []).map((it) => ({
    food_id: it.food_id, food_name: it.food_id ? undefined : it.name,
    name: it.name, quantity_g: it.quantity_g,
  }));

  const dateInput = el("input", { type: "datetime-local", value: toLocalInputValue(meal.timestamp) });
  const noteInput = el("input", { type: "text", placeholder: "Note (optional)", value: meal.note || "" });
  const itemsEl = el("ul", { class: "items" });
  const searchInput = el("input", { type: "search", placeholder: "Add a food…", autocomplete: "off" });
  const resultsEl = el("ul", { class: "results" });

  function renderItems() {
    clear(itemsEl);
    if (!items.length) {
      itemsEl.appendChild(el("p", { class: "muted small", text: "No items. Add one below, or delete the meal." }));
      return;
    }
    items.forEach((item, idx) => {
      const qtyInput = el("input", {
        class: "qty-input", type: "text", inputmode: "decimal", value: String(item.quantity_g),
        "aria-label": "Grams for " + item.name,
      });
      qtyInput.addEventListener("change", () => {
        const v = parseDecimal(qtyInput.value);
        if (v == null || Number.isNaN(v) || v <= 0) { qtyInput.value = String(item.quantity_g); return; }
        item.quantity_g = v;
      });
      itemsEl.appendChild(el("li", { class: "item" }, [
        el("span", { class: "name", text: item.name }),
        qtyInput,
        el("span", { class: "unit", text: "g" }),
        el("button", {
          class: "iconbtn", "aria-label": "Remove " + item.name, text: "✕",
          onclick: () => { items.splice(idx, 1); renderItems(); },
        }),
      ]));
    });
  }

  function addFromCatalog(food) {
    items.push({ food_id: food.id, name: food.name, quantity_g: food.serving_g || 100 });
    searchInput.value = ""; renderResults(""); renderItems();
  }
  function addNew(name) {
    items.push({ food_name: name.trim(), name: name.trim(), quantity_g: 100 });
    searchInput.value = ""; renderResults(""); renderItems();
  }

  function renderResults(query) {
    clear(resultsEl);
    const q = normalizeText(query);
    if (!q) return;
    const foods = state.getFoods();
    const exact = foods.some((f) => normalizeText(f.name) === q);
    if (!exact) {
      resultsEl.appendChild(el("li", { class: "add-new", onclick: () => addNew(query) }, [
        el("span", { text: `Add “${query.trim()}” as new food` }), el("span", { class: "meta", text: "new" }),
      ]));
    }
    foods.filter((f) => normalizeText(f.name).includes(q)).slice(0, 8).forEach((f) => {
      resultsEl.appendChild(el("li", { onclick: () => addFromCatalog(f) }, [el("span", { text: f.name })]));
    });
  }
  searchInput.addEventListener("input", () => renderResults(searchInput.value));

  const saveBtn = el("button", { class: "btn primary", text: "Save" });
  saveBtn.addEventListener("click", async () => {
    if (!items.length) { toast("Add an item, or delete the meal.", { error: true }); return; }
    const iso = dateInput.value ? state.toLocalIso(new Date(dateInput.value)) : meal.timestamp;
    const payloadItems = items.map((it) =>
      it.food_id ? { food_id: it.food_id, quantity_g: it.quantity_g }
                 : { food_name: it.name, quantity_g: it.quantity_g });
    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {
      const updated = await api.updateMeal({ id: meal.id, timestamp: iso, note: noteInput.value.trim(), items: payloadItems });
      const hadNew = items.some((it) => !it.food_id);
      if (hadNew) { try { await state.loadFoods(true); } catch (_) {} }
      state.replaceMeal(updated);
      closeModal();
      toast("Meal updated");
      if (onSaved) onSaved(updated);
    } catch (err) {
      saveBtn.disabled = false; saveBtn.textContent = "Save";
      toast(err.message || "Could not update the meal.", { error: true });
    }
  });

  // Delete with an inline two-click confirm (no browser dialog).
  const deleteBtn = el("button", { class: "btn danger", text: "Delete" });
  let armed = false;
  deleteBtn.addEventListener("click", async () => {
    if (!armed) { armed = true; deleteBtn.textContent = "Tap again to delete"; return; }
    deleteBtn.disabled = true; deleteBtn.textContent = "Deleting…";
    try {
      await api.deleteMeal(meal.id);
      state.removeMeal(meal.id);
      closeModal();
      toast("Meal deleted");
      if (onDeleted) onDeleted(meal.id);
    } catch (err) {
      armed = false; deleteBtn.disabled = false; deleteBtn.textContent = "Delete";
      toast(err.message || "Could not delete the meal.", { error: true });
    }
  });

  const form = el("div", {}, [
    el("h2", { text: "Edit meal" }),
    el("label", { class: "field" }, [el("span", { text: "When" }), dateInput]),
    el("div", { class: "section-title", text: "Items" }),
    itemsEl,
    el("label", { class: "field", style: "margin-top:10px" }, [el("span", { text: "Add food" }), searchInput]),
    resultsEl,
    el("label", { class: "field", style: "margin-top:10px" }, [el("span", { text: "Note" }), noteInput]),
    el("div", { class: "actions" }, [
      el("button", { class: "btn", text: "Cancel", onclick: closeModal }),
      saveBtn,
    ]),
    el("div", { style: "margin-top:10px; text-align:center" }, [deleteBtn]),
  ]);

  openModal(form);
  renderItems();
}

// ---- Dish editor (create / edit a recipe, from the Dishes tab) ----

// dish: a catalog food object with { id, name, servings, recipe:[{food_id,name,quantity_g}] },
// or null to create a new dish.
export function openDishEditor(dish, { onSaved } = {}) {
  const isEdit = !!dish;
  const ingredients = (dish ? state.getRecipe(dish.id) : []).map((i) => ({
    food_id: i.food_id, food_name: undefined, name: i.name, quantity_g: i.quantity_g,
  }));

  const nameInput = el("input", { type: "text", value: dish ? dish.name : "", autocomplete: "off" });
  const servingsInput = el("input", {
    type: "text", inputmode: "decimal", autocomplete: "off",
    value: dish && dish.servings != null ? String(dish.servings) : "", placeholder: "e.g. 8",
  });
  const itemsEl = el("ul", { class: "items" });
  const searchInput = el("input", { type: "search", placeholder: "Add an ingredient…", autocomplete: "off" });
  const resultsEl = el("ul", { class: "results" });
  const previewEl = el("div", { class: "card", style: "margin-top:10px" });

  function renderPreview() {
    clear(previewEl);
    const totals = itemsTotals(ingredients);
    const totalG = ingredients.reduce((s, i) => s + (Number(i.quantity_g) || 0), 0);
    const servings = parseDecimal(servingsInput.value);
    const geq = (m) => (totals.incomplete[m] ? "≥" : "");
    const line = (label, factor) =>
      `${label}: ${geq("kcal")}${formatNum(totals.kcal * factor)} kcal · ` +
      `P ${geq("protein")}${formatNum(totals.protein * factor, 1)} · ` +
      `C ${geq("carbs")}${formatNum(totals.carbs * factor, 1)} · ` +
      `F ${geq("fat")}${formatNum(totals.fat * factor, 1)} g`;
    const rows = [el("div", { class: "section-title", text: `Whole dish · ${formatNum(totalG)} g` })];
    rows.push(el("div", { class: "small", text: line("Total", 1) }));
    if (servings && servings > 0) {
      rows.push(el("div", { class: "small", text: line(`Per serving (÷${formatNum(servings)})`, 1 / servings) }));
    } else {
      rows.push(el("div", { class: "muted small", text: "Set servings to see per-serving values." }));
    }
    previewEl.append(...rows);
  }

  function renderItems() {
    clear(itemsEl);
    if (!ingredients.length) {
      itemsEl.appendChild(el("p", { class: "muted small", text: "No ingredients yet. Add some below." }));
      renderPreview(); return;
    }
    ingredients.forEach((item, idx) => {
      const qty = el("input", { class: "qty-input", type: "text", inputmode: "decimal", value: String(item.quantity_g), "aria-label": "Grams for " + item.name });
      qty.addEventListener("change", () => {
        const v = parseDecimal(qty.value);
        if (v == null || Number.isNaN(v) || v <= 0) { qty.value = String(item.quantity_g); return; }
        item.quantity_g = v; renderPreview();
      });
      itemsEl.appendChild(el("li", { class: "item" }, [
        el("span", { class: "name", text: item.name }),
        qty, el("span", { class: "unit", text: "g" }),
        el("button", { class: "iconbtn", "aria-label": "Remove " + item.name, text: "✕", onclick: () => { ingredients.splice(idx, 1); renderItems(); } }),
      ]));
    });
    renderPreview();
  }

  function addFromCatalog(food) {
    ingredients.push({ food_id: food.id, name: food.name, quantity_g: food.serving_g || 100 });
    searchInput.value = ""; renderResults(""); renderItems();
  }
  function addNew(name) {
    ingredients.push({ food_name: name.trim(), name: name.trim(), quantity_g: 100 });
    searchInput.value = ""; renderResults(""); renderItems();
  }
  function renderResults(query) {
    clear(resultsEl);
    const q = normalizeText(query);
    if (!q) return;
    const foods = state.getFoods().filter((f) => !f.is_dish); // ingredients are basic foods only
    const exact = foods.some((f) => normalizeText(f.name) === q);
    if (!exact) {
      resultsEl.appendChild(el("li", { class: "add-new", onclick: () => addNew(query) }, [
        el("span", { text: `Add “${query.trim()}” as new food` }), el("span", { class: "meta", text: "new" }),
      ]));
    }
    foods.filter((f) => normalizeText(f.name).includes(q)).slice(0, 8).forEach((f) => {
      resultsEl.appendChild(el("li", { onclick: () => addFromCatalog(f) }, [el("span", { text: f.name })]));
    });
  }
  searchInput.addEventListener("input", () => renderResults(searchInput.value));
  servingsInput.addEventListener("input", renderPreview);

  const saveBtn = el("button", { class: "btn primary", text: "Save" });
  saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) { toast("Enter a dish name.", { error: true }); return; }
    if (!ingredients.length) { toast("Add at least one ingredient.", { error: true }); return; }
    const servings = parseDecimal(servingsInput.value);
    if (Number.isNaN(servings) || (servings != null && servings <= 0)) { toast("Servings must be a positive number.", { error: true }); return; }

    const payloadIngredients = ingredients.map((it) =>
      it.food_id ? { food_id: it.food_id, quantity_g: it.quantity_g } : { food_name: it.name, quantity_g: it.quantity_g });

    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {
      const saved = isEdit
        ? await api.updateDish({ id: dish.id, name, servings, ingredients: payloadIngredients })
        : await api.addDish({ name, servings, ingredients: payloadIngredients });
      await state.loadFoods(true);          // pick up the dish food + any new ingredient foods
      state.setRecipe(saved.id, saved.ingredients); // set recipe + recompute the dish
      closeModal();
      toast(isEdit ? "Dish updated" : "Dish created");
      if (onSaved) onSaved(saved);
    } catch (err) {
      saveBtn.disabled = false; saveBtn.textContent = "Save";
      toast(err.message || "Could not save the dish.", { error: true });
    }
  });

  const form = el("div", {}, [
    el("h2", { text: isEdit ? "Edit dish" : "New dish" }),
    el("label", { class: "field" }, [el("span", { text: "Name" }), nameInput]),
    el("label", { class: "field" }, [el("span", { text: "Servings (optional)" }), servingsInput]),
    el("div", { class: "section-title", text: "Ingredients" }),
    itemsEl,
    el("label", { class: "field", style: "margin-top:10px" }, [el("span", { text: "Add ingredient" }), searchInput]),
    resultsEl,
    previewEl,
    el("div", { class: "actions" }, [
      el("button", { class: "btn", text: "Cancel", onclick: closeModal }),
      saveBtn,
    ]),
  ]);

  openModal(form);
  renderItems();
  if (!isEdit) nameInput.focus();
}

export { NUTRIENT_FIELDS };
