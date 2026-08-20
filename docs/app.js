// app.js — entry point. Gates the app behind a shared password, loads initial data,
// wires the bottom tab bar, and renders the active view.

import * as auth from "./auth.js";
import * as state from "./state.js";
import { setReauthHandler } from "./api.js";
import { el, clear, toast } from "./ui.js";
import { createLogView } from "./views/log.js";
import { createFoodsView } from "./views/foods.js";
import { createDishesView } from "./views/dishes.js";
import { createHistoryView } from "./views/history.js";
import { createExerciseLogView } from "./views/exercise-log.js";
import { createExercisesView } from "./views/exercises.js";
import { createWorkoutsHistoryView } from "./views/workouts-history.js";

// Cosmetic frontend version — purely a visual cue to confirm which build is live.
// Bump the number on every commit that changes the frontend.
const APP_VERSION = "version 10";

const signinScreen = document.getElementById("signin-screen");
const appEl = document.getElementById("app");
const pageHost = document.getElementById("page-host");
const pageHeadTop = document.getElementById("page-head-top");
const pageHeadLeft = document.getElementById("page-head-left");
const pageFoot = document.getElementById("page-foot");
const catalogSeg = document.getElementById("catalog-seg");
const catalogControls = document.getElementById("catalog-controls");

let views = null;
let started = false;

// Navigation context handed to each view: open the Foods/Dishes catalog or History as a popup
// (food side), or the Exercises catalog / workout History (exercise side).
const ctx = { openCatalog, openHistory, openExerciseCatalog, openWorkoutHistory };

// ---- Page popup (catalogs + histories, shown over the base screen) ----

// Show one of the popup's sections, hide the others.
function showSection(name) {
  ["foods", "dishes", "history", "exercises", "workouts"].forEach((n) => {
    document.getElementById("view-" + n).hidden = n !== name;
  });
}

function closePage() { pageHost.hidden = true; }

// Foods catalog popup. Segment + the active view's controls + close live in the fixed bottom bar
// (#page-foot); the list scrolls in the body above. Each view renders its controls into
// #catalog-controls and its list into its own section.
function openCatalog(opts = {}) {
  pageHeadTop.hidden = true;   // catalog uses the bottom bar, not the top header
  pageFoot.hidden = false;
  clear(catalogSeg);
  const foodsBtn = el("button", { class: "seg-btn", role: "tab", "aria-selected": "true", text: "📋 Foods" });
  const dishesBtn = el("button", { class: "seg-btn", role: "tab", "aria-selected": "false", text: "🍲 Dishes" });
  function select(which) {
    const isFoods = which === "foods";
    foodsBtn.setAttribute("aria-selected", String(isFoods));
    dishesBtn.setAttribute("aria-selected", String(!isFoods));
    showSection(which);
    if (isFoods) views.foods.show(opts, catalogControls);
    else views.dishes.show({}, catalogControls);
  }
  foodsBtn.addEventListener("click", () => select("foods"));
  dishesBtn.addEventListener("click", () => select("dishes"));
  catalogSeg.appendChild(el("div", { class: "segment", role: "tablist" }, [foodsBtn, dishesBtn]));
  pageHost.hidden = false;
  select("foods");
}

// History popup — top header (title + close), no bottom bar.
function openHistory() {
  pageFoot.hidden = true;
  pageHeadTop.hidden = false;
  clear(pageHeadLeft);
  pageHeadLeft.appendChild(el("h2", { class: "page-title", text: "History" }));
  pageHost.hidden = false;
  showSection("history");
  views.history.show();
}

// Exercises catalog popup. Reuses the fixed bottom bar, but shows a plain "Exercises" title
// in place of the Foods|Dishes segment (there's no dishes equivalent for exercises).
function openExerciseCatalog(opts = {}) {
  pageHeadTop.hidden = true;
  pageFoot.hidden = false;
  clear(catalogSeg);
  catalogSeg.appendChild(el("div", { class: "segment" }, [
    el("button", { class: "seg-btn", "aria-selected": "true", text: "🏋 Exercises" }),
  ]));
  pageHost.hidden = false;
  showSection("exercises");
  views.exercises.show(opts, catalogControls);
}

// Workout history popup — top header (title + close), no bottom bar (mirrors openHistory).
function openWorkoutHistory() {
  pageFoot.hidden = true;
  pageHeadTop.hidden = false;
  clear(pageHeadLeft);
  pageHeadLeft.appendChild(el("h2", { class: "page-title", text: "Workout history" }));
  pageHost.hidden = false;
  showSection("workouts");
  views.workouts.show();
}

// ---- Bottom tab bar (switches the base page: Food entry <-> Exercise entry) ----

let currentPage = "food";

function showPage(page) {
  currentPage = page;
  document.getElementById("view-log").hidden = page !== "food";
  document.getElementById("view-exercise-log").hidden = page !== "exercise";
  document.querySelectorAll("#tabbar .tab-btn").forEach((btn) => {
    btn.setAttribute("aria-selected", String(btn.dataset.page === page));
  });
  if (page === "exercise") views.exerciseLog.show();
  else views.log.show();
}

function wireTabbar() {
  document.querySelectorAll("#tabbar .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => showPage(btn.dataset.page));
  });
}

// Wire the popup's close affordances once (both X buttons + tap-outside).
function wirePage() {
  document.getElementById("page-close-top").addEventListener("click", closePage);
  document.getElementById("page-close-foot").addEventListener("click", closePage);
  pageHost.addEventListener("click", (e) => { if (e.target === pageHost) closePage(); });
}

function renderAccountFooter() {
  const existing = document.getElementById("account-footer");
  if (existing) existing.remove();
  const footer = el("div", { id: "account-footer", class: "footer-account" }, [
    el("span", { text: "Signed in on " + auth.getEmail() }),
    document.createTextNode(" · "),
    el("button", { text: "Forget password", onclick: () => auth.signOut() }),
    document.createTextNode(" · "),
    el("span", { class: "muted", text: APP_VERSION }),
  ]);
  document.querySelector(".views").appendChild(footer);
}

// Called once the user has a stored secret. Idempotent (built views only once).
async function startApp() {
  signinScreen.hidden = true;
  appEl.hidden = false;

  if (!started) {
    started = true;
    views = {
      log: createLogView(ctx),
      foods: createFoodsView(ctx),
      dishes: createDishesView(ctx),
      history: createHistoryView(ctx),
      exerciseLog: createExerciseLogView(ctx),
      exercises: createExercisesView(ctx),
      workouts: createWorkoutsHistoryView(ctx),
    };
    wirePage();
    wireTabbar();
  }

  // Render the Log shell immediately so the user sees the app right away; the macro summary
  // card shows a spinner until the data arrives (state.isBootstrapDone()). The startup request
  // can take several seconds (Apps Script), so we don't block the first paint on it.
  renderAccountFooter();
  showPage("food"); // Food Log is the default base screen; the tab bar switches to Exercise

  try {
    await state.loadBootstrap(); // one request: foods + settings + recent meals (+ exercises)
  } catch (err) {
    toast("Couldn't reach the server. Check config.js / your connection.", { error: true });
  }

  showPage(currentPage); // re-render the active page now that the data is loaded
}

// Re-auth handler for api.js: show the password screen and resolve once re-entered.
// Returns a Promise so the failed request can retry with the fresh secret.
function requestReauth(message) {
  return new Promise((resolve) => {
    appEl.hidden = true;
    auth.promptForSecret({
      container: signinScreen,
      message,
      onUnlock: () => { signinScreen.hidden = true; appEl.hidden = false; resolve(); },
    });
  });
}

function boot() {
  setReauthHandler(requestReauth);

  if (auth.hasSecret()) {
    startApp();
  } else {
    auth.promptForSecret({
      container: signinScreen,
      onUnlock: () => startApp(),
    });
  }
}

boot();
