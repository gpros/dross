// app.js — entry point. Gates the app behind a shared password, loads initial data,
// wires the bottom tab bar, and renders the active view.

import * as auth from "./auth.js";
import * as state from "./state.js";
import { setReauthHandler } from "./api.js";
import { el, toast } from "./ui.js";
import { createLogView } from "./views/log.js";
import { createFoodsView } from "./views/foods.js";
import { createDishesView } from "./views/dishes.js";
import { createHistoryView } from "./views/history.js";

// Cosmetic frontend version — purely a visual cue to confirm which build is live.
// Bump the number on every commit that changes the frontend.
const APP_VERSION = "version 1";

const signinScreen = document.getElementById("signin-screen");
const appEl = document.getElementById("app");

let views = null;
let started = false;

// Navigation context handed to each view.
const ctx = { navigate };

function navigate(name, opts = {}) {
  document.querySelectorAll(".view").forEach((sec) => {
    sec.hidden = sec.dataset.view !== name;
  });
  document.querySelectorAll(".tab").forEach((t) => {
    t.setAttribute("aria-selected", String(t.dataset.tab === name));
  });
  views[name].show(opts);
}

function wireTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => navigate(tab.dataset.tab));
  });
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
    wireTabs();
  }

  try {
    await state.loadBootstrap(); // one request: foods + settings + recent meals
  } catch (err) {
    toast("Couldn't reach the server. Check config.js / your connection.", { error: true });
  }

  renderAccountFooter();
  navigate("log");
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
