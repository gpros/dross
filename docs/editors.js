// editors.js — modal editors shared across views: daily targets, food add/edit, and
// the quantity prompt used when adding a food to a meal.

import * as api from "./api.js";
import * as state from "./state.js";
import {
  el, clear, openModal, closeModal, parseDecimal, toast, normalizeText, formatNum,
  displayName, matchingName, foodMatchesQuery, foodMatchesExact,
} from "./ui.js";
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

// The three name fields shared by the food and dish editors (English / Spanish / free-form).
const NAME_FIELDS = [
  { key: "name", label: "Name (English)" },
  { key: "name_es", label: "Name (Spanish)" },
  { key: "name_free", label: "Name (free-form)" },
];

// Build the three name inputs (prefilled from `food`/`dish` when editing) plus rows to drop
// into a form. `collect()` validates (at least one non-empty) and returns a
// { name, name_es, name_free } patch, or null after showing a toast.
function nameFields(item) {
  const inputs = {};
  const rows = NAME_FIELDS.map((f) => {
    const inp = el("input", { type: "text", value: item ? (item[f.key] || "") : "", autocomplete: "off" });
    inputs[f.key] = inp;
    return el("label", { class: "field" }, [el("span", { text: f.label }), inp]);
  });
  function collect() {
    const patch = {};
    NAME_FIELDS.forEach((f) => { patch[f.key] = inputs[f.key].value.trim(); });
    if (!patch.name && !patch.name_es && !patch.name_free) {
      toast("Enter at least one name.", { error: true });
      return null;
    }
    return patch;
  }
  return { inputs, rows, collect };
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
  const names = nameFields(food);
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
    ...names.rows,
    el("p", { class: "muted small", text: "Fill in at least one name. Leave a nutrition field blank for “unknown” (different from 0)." }),
    ...rows,
    fieldRow("Default serving", "g, optional", servingInput),
    el("div", { class: "actions" }, [
      el("button", { class: "btn", text: "Cancel", onclick: closeModal }),
      saveBtn,
    ]),
  ]);

  saveBtn.addEventListener("click", async () => {
    const namePatch = names.collect();
    if (!namePatch) return;

    const patch = { ...namePatch };
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
  names.inputs.name.focus();
}

// ---- Quantity prompt (adding a food to a meal) ----

const SERVING_MULTIPLIERS = [0.5, 1, 2, 3];

// `food` may be a food object { name, serving_g? } or a bare name string.
// Returns a Promise resolving to a positive number (grams), or null if cancelled.
export function promptQuantity(food, defaultQty = "") {
  const name = typeof food === "string" ? food : (food ? displayName(food) : "");
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
    items.push({ food_id: food.id, name: displayName(food), quantity_g: food.serving_g || 100 });
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
    const exact = foods.some((f) => foodMatchesExact(f, q));
    if (!exact) {
      resultsEl.appendChild(el("li", { class: "add-new", onclick: () => addNew(query) }, [
        el("span", { text: `Add “${query.trim()}” as new food` }), el("span", { class: "meta", text: "new" }),
      ]));
    }
    foods.filter((f) => foodMatchesQuery(f, q)).slice(0, 8).forEach((f) => {
      resultsEl.appendChild(el("li", { onclick: () => addFromCatalog(f) }, [el("span", { text: matchingName(f, q) })]));
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

  const names = nameFields(dish);
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
    ingredients.push({ food_id: food.id, name: displayName(food), quantity_g: food.serving_g || 100 });
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
    const exact = foods.some((f) => foodMatchesExact(f, q));
    if (!exact) {
      resultsEl.appendChild(el("li", { class: "add-new", onclick: () => addNew(query) }, [
        el("span", { text: `Add “${query.trim()}” as new food` }), el("span", { class: "meta", text: "new" }),
      ]));
    }
    foods.filter((f) => foodMatchesQuery(f, q)).slice(0, 8).forEach((f) => {
      resultsEl.appendChild(el("li", { onclick: () => addFromCatalog(f) }, [el("span", { text: matchingName(f, q) })]));
    });
  }
  searchInput.addEventListener("input", () => renderResults(searchInput.value));
  servingsInput.addEventListener("input", renderPreview);

  const saveBtn = el("button", { class: "btn primary", text: "Save" });
  saveBtn.addEventListener("click", async () => {
    const namePatch = names.collect();
    if (!namePatch) return;
    if (!ingredients.length) { toast("Add at least one ingredient.", { error: true }); return; }
    const servings = parseDecimal(servingsInput.value);
    if (Number.isNaN(servings) || (servings != null && servings <= 0)) { toast("Servings must be a positive number.", { error: true }); return; }

    const payloadIngredients = ingredients.map((it) =>
      it.food_id ? { food_id: it.food_id, quantity_g: it.quantity_g } : { food_name: it.name, quantity_g: it.quantity_g });

    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {
      const saved = isEdit
        ? await api.updateDish({ id: dish.id, ...namePatch, servings, ingredients: payloadIngredients })
        : await api.addDish({ ...namePatch, servings, ingredients: payloadIngredients });
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
    ...names.rows,
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
  if (!isEdit) names.inputs.name.focus();
}

// ---- Exercise tracker editors -------------------------------------------------

// The four numbers captured for one logged exercise. `short` labels the compact inline grid,
// `long` labels the add prompt. reps/sets are required & positive; weight/duration optional.
const SET_FIELDS = [
  { key: "reps", short: "Reps", long: "Reps", positive: true, required: false },
  { key: "sets", short: "Sets", long: "Sets", positive: true, required: false },
  { key: "weight", short: "Kg", long: "Weight (kg)", positive: false, required: false },
  { key: "duration_min", short: "Min", long: "Duration (min)", positive: true, required: false },
];

// Renders a compact grid of the four set inputs bound to `values` (mutated in place). Empty is
// allowed for optional fields (=> null); a bad/empty required field reverts to its prior value.
// `onChange(patch)` fires after each accepted edit. Shared by the exercise log and the workout
// editor.
export function exerciseSetFields(values, onChange = () => {}) {
  const grid = el("div", { class: "set-fields" });
  SET_FIELDS.forEach((f) => {
    const input = el("input", {
      class: "set-input", type: "text", inputmode: "decimal", autocomplete: "off",
      value: values[f.key] == null ? "" : String(values[f.key]), "aria-label": f.long,
    });
    input.addEventListener("change", () => {
      const raw = input.value.trim();
      if (raw === "") {
        if (f.required) { input.value = values[f.key] == null ? "" : String(values[f.key]); return; }
        values[f.key] = null; onChange({ [f.key]: null }); return;
      }
      const v = parseDecimal(raw);
      if (v == null || Number.isNaN(v) || (f.positive ? v <= 0 : v < 0)) {
        input.value = values[f.key] == null ? "" : String(values[f.key]); return;
      }
      values[f.key] = v; onChange({ [f.key]: v });
    });
    grid.appendChild(el("label", { class: "set-field" }, [el("span", { text: f.short }), input]));
  });
  return grid;
}

// Prompt for reps/sets/weight/duration when adding an exercise to the draft workout. Prefilled
// from the exercise's defaults (or `initial` when re-editing). Resolves { reps, sets, weight,
// duration_min } (weight/duration may be null), or null if cancelled.
export function promptExerciseSet(exercise, initial = null) {
  const name = typeof exercise === "string" ? exercise : (exercise ? displayName(exercise) : "");
  const start = initial || {
    reps: exercise && exercise.default_reps != null ? exercise.default_reps : null,
    sets: exercise && exercise.default_sets != null ? exercise.default_sets : null,
    weight: exercise && exercise.default_weight != null ? exercise.default_weight : null,
    duration_min: exercise && exercise.default_duration_min != null ? exercise.default_duration_min : null,
  };

  return new Promise((resolve) => {
    const inputs = {};
    const rows = SET_FIELDS.map((f) => {
      const inp = el("input", {
        type: "text", inputmode: "decimal", autocomplete: "off",
        value: start[f.key] == null ? "" : String(start[f.key]),
        placeholder: f.required ? "required" : "optional",
      });
      inputs[f.key] = inp;
      return el("label", { class: "field" }, [el("span", { text: f.long }), inp]);
    });

    const addBtn = el("button", { class: "btn primary", text: "Add" });
    function submit() {
      const out = {};
      for (const f of SET_FIELDS) {
        const raw = inputs[f.key].value.trim();
        if (raw === "") {
          if (f.required) { toast(`${f.long} is required.`, { error: true }); return; }
          out[f.key] = null; continue;
        }
        const v = parseDecimal(raw);
        if (v == null || Number.isNaN(v) || (f.positive ? v <= 0 : v < 0)) {
          toast(`${f.long} must be ${f.positive ? "a positive" : "a zero or positive"} number.`, { error: true });
          return;
        }
        out[f.key] = v;
      }
      closeModal();
      resolve(out);
    }
    addBtn.addEventListener("click", submit);
    Object.values(inputs).forEach((inp) => inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); }));

    const children = [
      el("h2", { text: name }),
      ...rows,
      el("div", { class: "actions" }, [
        el("button", { class: "btn", text: "Cancel", onclick: () => { closeModal(); resolve(null); } }),
        addBtn,
      ]),
    ];
    openModal(el("div", {}, children));
    inputs.reps.focus();
  });
}

// The optional default fields on an exercise (mirror NUTRIENT_FIELDS for the food editor).
const EXERCISE_DEFAULT_FIELDS = [
  { key: "default_reps", label: "Default reps", unit: "optional", positive: true },
  { key: "default_sets", label: "Default sets", unit: "optional", positive: true },
  { key: "default_weight", label: "Default weight", unit: "kg, optional", positive: false },
  { key: "default_duration_min", label: "Default duration", unit: "min, optional", positive: true },
];

// exercise === null -> add mode; exercise object -> edit mode (prefilled).
export function openExerciseEditor(exercise, { onSaved } = {}) {
  const isEdit = !!exercise;
  const names = nameFields(exercise);
  const inputs = {};
  const rows = EXERCISE_DEFAULT_FIELDS.map((f) => {
    const inp = decimalInput(exercise ? exercise[f.key] : "");
    inputs[f.key] = inp;
    return fieldRow(f.label, f.unit, inp);
  });

  const saveBtn = el("button", { class: "btn primary", text: "Save" });
  const form = el("div", {}, [
    el("h2", { text: isEdit ? "Edit exercise" : "Add exercise" }),
    ...names.rows,
    el("p", { class: "muted small", text: "Fill in at least one name. Defaults are optional — they prefill the log, where you can override them each time." }),
    ...rows,
    el("div", { class: "actions" }, [
      el("button", { class: "btn", text: "Cancel", onclick: closeModal }),
      saveBtn,
    ]),
  ]);

  saveBtn.addEventListener("click", async () => {
    const namePatch = names.collect();
    if (!namePatch) return;

    const patch = { ...namePatch };
    for (const f of EXERCISE_DEFAULT_FIELDS) {
      const v = parseDecimal(inputs[f.key].value);
      if (Number.isNaN(v)) { toast(`${f.label} must be a number.`, { error: true }); return; }
      if (v != null && (f.positive ? v <= 0 : v < 0)) {
        toast(`${f.label} must be ${f.positive ? "positive" : "zero or positive"}.`, { error: true }); return;
      }
      patch[f.key] = v; // null => clear
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      const saved = isEdit
        ? await api.updateExercise({ id: exercise.id, ...patch })
        : await api.addExercise(patch);
      state.upsertExercise(saved);
      closeModal();
      toast(isEdit ? "Exercise updated" : "Exercise added");
      if (onSaved) onSaved(saved);
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      toast(err.message || "Could not save exercise.", { error: true });
    }
  });

  openModal(form);
  names.inputs.name.focus();
}

// ---- Workout editor (edit / delete a logged workout, from History) ----

// workout: { id, timestamp, note, items:[{exercise_id, name, reps, sets, weight, duration_min}] }
export function openWorkoutEditor(workout, { onSaved, onDeleted } = {}) {
  const items = (workout.items || []).map((it) => ({
    exercise_id: it.exercise_id, exercise_name: it.exercise_id ? undefined : it.name,
    name: it.name, reps: it.reps, sets: it.sets, weight: it.weight, duration_min: it.duration_min,
  }));

  const dateInput = el("input", { type: "datetime-local", value: toLocalInputValue(workout.timestamp) });
  const noteInput = el("input", { type: "text", placeholder: "Note (optional)", value: workout.note || "" });
  const itemsEl = el("ul", { class: "items" });
  const searchInput = el("input", { type: "search", placeholder: "Add an exercise…", autocomplete: "off" });
  const resultsEl = el("ul", { class: "results" });

  function renderItems() {
    clear(itemsEl);
    if (!items.length) {
      itemsEl.appendChild(el("p", { class: "muted small", text: "No exercises. Add one below, or delete the workout." }));
      return;
    }
    items.forEach((item, idx) => {
      itemsEl.appendChild(el("li", { class: "item exercise-item" }, [
        el("div", { class: "row between" }, [
          el("span", { class: "name", text: item.name }),
          el("button", {
            class: "iconbtn", "aria-label": "Remove " + item.name, text: "✕",
            onclick: () => { items.splice(idx, 1); renderItems(); },
          }),
        ]),
        exerciseSetFields(item),
      ]));
    });
  }

  function addFromCatalog(ex) {
    items.push({
      exercise_id: ex.id, name: displayName(ex),
      reps: ex.default_reps ?? null, sets: ex.default_sets ?? null,
      weight: ex.default_weight ?? null, duration_min: ex.default_duration_min ?? null,
    });
    searchInput.value = ""; renderResults(""); renderItems();
  }
  function addNew(name) {
    items.push({ exercise_name: name.trim(), name: name.trim(), reps: null, sets: null, weight: null, duration_min: null });
    searchInput.value = ""; renderResults(""); renderItems();
  }
  function renderResults(query) {
    clear(resultsEl);
    const q = normalizeText(query);
    if (!q) return;
    const exercises = state.getExercises();
    const exact = exercises.some((e) => foodMatchesExact(e, q));
    if (!exact) {
      resultsEl.appendChild(el("li", { class: "add-new", onclick: () => addNew(query) }, [
        el("span", { text: `Add “${query.trim()}” as new exercise` }), el("span", { class: "meta", text: "new" }),
      ]));
    }
    exercises.filter((e) => foodMatchesQuery(e, q)).slice(0, 8).forEach((e) => {
      resultsEl.appendChild(el("li", { onclick: () => addFromCatalog(e) }, [el("span", { text: matchingName(e, q) })]));
    });
  }
  searchInput.addEventListener("input", () => renderResults(searchInput.value));

  const saveBtn = el("button", { class: "btn primary", text: "Save" });
  saveBtn.addEventListener("click", async () => {
    if (!items.length) { toast("Add an exercise, or delete the workout.", { error: true }); return; }
    // reps/sets/weight/duration are all optional (e.g. time-only exercises) — no per-item check.
    const iso = dateInput.value ? state.toLocalIso(new Date(dateInput.value)) : workout.timestamp;
    const payloadItems = items.map((it) => ({
      ...(it.exercise_id ? { exercise_id: it.exercise_id } : { exercise_name: it.name }),
      reps: it.reps, sets: it.sets, weight: it.weight ?? null, duration_min: it.duration_min ?? null,
    }));
    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {
      const updated = await api.updateWorkout({ id: workout.id, timestamp: iso, note: noteInput.value.trim(), items: payloadItems });
      const hadNew = items.some((it) => !it.exercise_id);
      if (hadNew) { try { await state.loadExercises(true); } catch (_) {} }
      state.replaceWorkout(updated);
      closeModal();
      toast("Workout updated");
      if (onSaved) onSaved(updated);
    } catch (err) {
      saveBtn.disabled = false; saveBtn.textContent = "Save";
      toast(err.message || "Could not update the workout.", { error: true });
    }
  });

  const deleteBtn = el("button", { class: "btn danger", text: "Delete" });
  let armed = false;
  deleteBtn.addEventListener("click", async () => {
    if (!armed) { armed = true; deleteBtn.textContent = "Tap again to delete"; return; }
    deleteBtn.disabled = true; deleteBtn.textContent = "Deleting…";
    try {
      await api.deleteWorkout(workout.id);
      state.removeWorkout(workout.id);
      closeModal();
      toast("Workout deleted");
      if (onDeleted) onDeleted(workout.id);
    } catch (err) {
      armed = false; deleteBtn.disabled = false; deleteBtn.textContent = "Delete";
      toast(err.message || "Could not delete the workout.", { error: true });
    }
  });

  const form = el("div", {}, [
    el("h2", { text: "Edit workout" }),
    el("label", { class: "field" }, [el("span", { text: "When" }), dateInput]),
    el("div", { class: "section-title", text: "Exercises" }),
    itemsEl,
    el("label", { class: "field", style: "margin-top:10px" }, [el("span", { text: "Add exercise" }), searchInput]),
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

export { NUTRIENT_FIELDS };
