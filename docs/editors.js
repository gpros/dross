// editors.js — modal editors shared across views: daily targets, food add/edit, and
// the quantity prompt used when adding a food to a meal.

import * as api from "./api.js";
import * as state from "./state.js";
import { el, openModal, closeModal, parseDecimal, toast } from "./ui.js";

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

  const saveBtn = el("button", { class: "btn primary", text: "Save" });
  const form = el("div", {}, [
    el("h2", { text: isEdit ? "Edit food" : "Add food" }),
    el("label", { class: "field" }, [el("span", { text: "Name" }), nameInput]),
    el("p", { class: "muted small", text: "Leave a nutrition field blank for “unknown” (different from 0)." }),
    ...rows,
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

// Returns a Promise resolving to a positive number (grams), or null if cancelled.
export function promptQuantity(foodName, defaultQty = "") {
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

    const form = el("div", {}, [
      el("h2", { text: foodName }),
      el("label", { class: "field" }, [el("span", { text: "Quantity (g)" }), input]),
      el("div", { class: "actions" }, [
        el("button", { class: "btn", text: "Cancel", onclick: () => { closeModal(); resolve(null); } }),
        addBtn,
      ]),
    ]);
    openModal(form);
    input.focus();
  });
}

export { NUTRIENT_FIELDS };
