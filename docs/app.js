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

// Cosmetic frontend version — purely a visual cue to confirm which build is live.
// Bump the number on every commit that changes the frontend.
const APP_VERSION = "version 2";

const signinScreen = document.getElementById("signin-screen");
const appEl = document.getElementById("app");
const pageHost = document.getElementById("page-host");
const pageHeadLeft = document.getElementById("page-head-left");

let views = null;
let started = false;

// Navigation context handed to each view: open the Foods/Dishes catalog or History as a popup.
const ctx = { openCatalog, openHistory };

// ---- Page popup (Foods / Dishes / History, shown over the Log screen) ----

// Show one of the popup's sections (foods|dishes|history), hide the others.
function showSection(name) {
  ["foods", "dishes", "history"].forEach((n) => {
    document.getElementById("view-" + n).hidden = n !== name;
  });
}

function closePage() { pageHost.hidden = true; }

// Foods catalog popup, with a Foods | Dishes segmented control in the header.
function openCatalog(opts = {}) {
  clear(pageHeadLeft);
  const foodsBtn = el("button", { class: "seg-btn", role: "tab", "aria-selected": "true", text: "📋 Foods" });
  const dishesBtn = el("button", { class: "seg-btn", role: "tab", "aria-selected": "false", text: "🍲 Dishes" });
  function select(which) {
    const isFoods = which === "foods";
    foodsBtn.setAttribute("aria-selected", String(isFoods));
    dishesBtn.setAttribute("aria-selected", String(!isFoods));
    showSection(which);
    if (isFoods) views.foods.show(opts); else views.dishes.show();
  }
  foodsBtn.addEventListener("click", () => select("foods"));
  dishesBtn.addEventListener("click", () => select("dishes"));
  pageHeadLeft.appendChild(el("div", { class: "segment", role: "tablist" }, [foodsBtn, dishesBtn]));
  pageHost.hidden = false;
  select("foods");
}

// History popup (no segment — just a title).
function openHistory() {
  clear(pageHeadLeft);
  pageHeadLeft.appendChild(el("h2", { class: "page-title", text: "History" }));
  pageHost.hidden = false;
  showSection("history");
  views.history.show();
}

// Wire the popup's close affordances once (X button + tap-outside).
function wirePage() {
  document.getElementById("page-close").addEventListener("click", closePage);
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
    };
    wirePage();
  }

  try {
    await state.loadBootstrap(); // one request: foods + settings + recent meals
  } catch (err) {
    toast("Couldn't reach the server. Check config.js / your connection.", { error: true });
  }

  renderAccountFooter();
  views.log.show(); // Log is the always-visible base screen
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
