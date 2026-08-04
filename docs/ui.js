// ui.js — shared rendering helpers, input parsing, toasts, modals, and the
// reusable target-summary component used by both the Log and History views.

import { MACROS } from "./nutrition.js";

// ---- Escaping & element helpers ----

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Create an element: el("div", {class:"x", onclick:fn}, [children | strings]).
// Text children are set via textContent, so user input is never injected as HTML.
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v; // only for trusted, code-authored markup
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "dataset") {
      Object.assign(node.dataset, v);
    } else {
      node.setAttribute(k, v === true ? "" : v);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// ---- Number parsing / formatting ----

// Accept both "." and "," as the decimal separator (mobile comma-locale keyboards).
// Returns a number, or null for blank input, or NaN for invalid input.
export function parseDecimal(str) {
  if (str == null) return null;
  const t = String(str).trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return isNaN(n) ? NaN : n;
}

export function formatNum(n, digits = 0) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

// ---- Accent/case-insensitive matching (search) ----

export function normalizeText(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// ---- Toast ----

export function toast(message, { error = false, duration = 2600 } = {}) {
  const host = document.getElementById("toast-host");
  const node = el("div", { class: "toast" + (error ? " error" : ""), text: message });
  host.appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transition = "opacity .3s";
    setTimeout(() => node.remove(), 320);
  }, duration);
}

// ---- Modal (bottom sheet) ----

export function openModal(contentNode) {
  const host = document.getElementById("modal-host");
  clear(host);
  const modal = el("div", { class: "modal", role: "dialog", "aria-modal": "true" }, [contentNode]);
  host.appendChild(modal);
  host.hidden = false;
  // Close on backdrop click.
  host.onclick = (e) => { if (e.target === host) closeModal(); };
  return { close: closeModal };
}

export function closeModal() {
  const host = document.getElementById("modal-host");
  host.hidden = true;
  host.onclick = null;
  clear(host);
}

// ---- Target summary component (shared by Log + History) ----

// Per-macro display config: label, unit, decimals, target settings key.
const MACRO_META = {
  kcal: { label: "Calories", unit: "kcal", digits: 0, targetKey: "target_kcal" },
  protein: { label: "Protein", unit: "g", digits: 0, targetKey: "target_protein_g" },
  carbs: { label: "Carbs", unit: "g", digits: 0, targetKey: "target_carbs_g" },
  fat: { label: "Fat", unit: "g", digits: 0, targetKey: "target_fat_g" },
};

function targetsAreSet(settings) {
  if (!settings) return false;
  return MACROS.some((m) => {
    const v = settings[MACRO_META[m].targetKey];
    return v != null && v !== "";
  });
}

/**
 * Render the summary as a DOM node.
 *
 * @param {object} totals   from nutrition.js (itemsTotals / mealsTotals / combineTotals)
 * @param {object} settings the settings object (targets may be null)
 * @param {object} opts     { compact, provisional, onEditTargets, onMissingClick }
 */
export function renderTargetBars(totals, settings, opts = {}) {
  const { compact = false, provisional = false, onEditTargets = null, onMissingClick = null } = opts;

  // No targets yet -> prompt. Only show the (actionable) button where a handler was given,
  // i.e. the Log view. Read-only contexts like History day headers pass no handler → nothing.
  if (!targetsAreSet(settings)) {
    if (!onEditTargets) return document.createTextNode("");
    return el("div", { class: "summary empty-targets" }, [
      el("button", {
        class: "btn small primary",
        text: "Set your daily targets",
        onclick: onEditTargets,
      }),
    ]);
  }

  const rows = MACROS.map((macro) => {
    const meta = MACRO_META[macro];
    const eaten = totals[macro];
    const targetRaw = settings[meta.targetKey];
    const target = targetRaw == null || targetRaw === "" ? null : Number(targetRaw);
    const incomplete = totals.incomplete[macro];
    const geq = incomplete ? "≥" : "";

    // Numbers line: "1,450 / 2,200 kcal · 750 left" or "+120 over".
    let diffNode = null;
    let fillPct = 0;
    let over = false;
    if (target && target > 0) {
      fillPct = Math.min(100, (eaten / target) * 100);
      over = eaten > target;
      if (over) {
        diffNode = el("span", {
          class: "diff over",
          text: "+" + formatNum(eaten - target, meta.digits) + " over",
        });
      } else {
        diffNode = el("span", {
          class: "diff left",
          text: formatNum(target - eaten, meta.digits) + " left",
        });
      }
    }

    const valuesText =
      geq + formatNum(eaten, meta.digits) +
      (target != null ? " / " + formatNum(target, meta.digits) : "") +
      " " + meta.unit;

    const fill = el("div", {
      class: "fill" + (over ? " over" : "") + (provisional ? " provisional" : ""),
    });
    fill.style.width = fillPct + "%";

    return el("div", { class: "macro" }, [
      el("div", { class: "macro-head" }, [
        el("span", { class: "macro-name", text: meta.label }),
        el("span", { class: "macro-values" }, [
          document.createTextNode(valuesText + (diffNode ? " · " : "")),
          diffNode,
        ]),
      ]),
      el("div", { class: "bar" }, [fill]),
    ]);
  });

  const children = [];

  // Provisional note (draft counted).
  if (provisional) {
    children.push(el("div", { class: "provisional-note", text: "Includes items you're adding now" }));
  }

  children.push(...rows);

  // Missing-data warning.
  const missingCount = totals.incompleteFoods ? totals.incompleteFoods.size : 0;
  if (missingCount > 0) {
    const label = missingCount === 1 ? "1 food missing data" : missingCount + " foods missing data";
    children.push(
      el("button", {
        class: "warn-line",
        title: "These totals are lower bounds",
        onclick: onMissingClick || (() => {}),
      }, ["⚠️ " + label])
    );
  }

  // If an edit handler is given, make the whole block tappable to edit targets.
  if (onEditTargets) {
    return el("button", {
      class: "summary-tap" + (compact ? " compact" : ""),
      "aria-label": "Edit daily targets",
      onclick: onEditTargets,
    }, children);
  }

  return el("div", { class: "summary" + (compact ? " compact" : "") }, children);
}

export { MACRO_META };
