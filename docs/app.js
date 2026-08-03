// app.js — entry point. Bootstraps Google Sign-In, loads initial data, wires the
// bottom tab bar, and renders the active view.

import * as auth from "./auth.js";
import * as state from "./state.js";
import { el, toast } from "./ui.js";
import { createLogView } from "./views/log.js";
import { createFoodsView } from "./views/foods.js";
import { createHistoryView } from "./views/history.js";

const signinScreen = document.getElementById("signin-screen");
const appEl = document.getElementById("app");

let views = null;
let current = null;

// Navigation context handed to each view.
const ctx = {
  navigate,
};

function navigate(name, opts = {}) {
  // Toggle sections.
  document.querySelectorAll(".view").forEach((sec) => {
    sec.hidden = sec.dataset.view !== name;
  });
  // Update tab selection.
  document.querySelectorAll(".tab").forEach((t) => {
    t.setAttribute("aria-selected", String(t.dataset.tab === name));
  });
  current = name;
  views[name].show(opts);
}

function wireTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => navigate(tab.dataset.tab));
  });
}

function renderAccountFooter() {
  // A small unobtrusive footer with the signed-in email + sign out, added to each view's
  // scroll area via the Foods view is awkward; instead put it fixed above the tab bar
  // only inside the Log view card area. Simplest: append to the app once.
  const existing = document.getElementById("account-footer");
  if (existing) existing.remove();
  const footer = el("div", { id: "account-footer", class: "footer-account" }, [
    el("span", { text: auth.getEmail() || "" }),
    document.createTextNode(" · "),
    el("button", { text: "Sign out", onclick: () => auth.signOut() }),
  ]);
  // Place it at the bottom of the views container.
  document.querySelector(".views").appendChild(footer);
}

async function onSignedIn() {
  signinScreen.hidden = true;
  appEl.hidden = false;

  views = {
    log: createLogView(ctx),
    foods: createFoodsView(ctx),
    history: createHistoryView(ctx),
  };
  wireTabs();

  // Load shared data needed by the first view (foods + settings). Views also load
  // their own data, but priming these avoids flicker and enables the summary bar.
  try {
    await Promise.all([state.loadFoods(), state.loadSettings()]);
  } catch (err) {
    toast("Couldn't reach the server. Check config.js / your connection.", { error: true });
  }

  renderAccountFooter();
  navigate("log");

  scheduleProactiveRefresh();
}

// Optionally refresh the token a bit before it expires, so long sessions stay smooth.
function scheduleProactiveRefresh() {
  const left = auth.secondsUntilExpiry();
  if (!left) return;
  const refreshIn = Math.max(30, left - 120) * 1000; // ~2 min before expiry
  setTimeout(async () => {
    try { await auth.refreshToken(); } catch (_) {}
    scheduleProactiveRefresh();
  }, refreshIn);
}

function boot() {
  signinScreen.hidden = false;
  appEl.hidden = true;
  auth.init({
    onFirstSignIn: onSignedIn,
    statusEl: document.getElementById("signin-status"),
    buttonEl: document.getElementById("gsi-button"),
  });
}

// GIS script loads async; wait for it (with a short poll) before initializing.
function waitForGis(attempt = 0) {
  if (window.google && google.accounts && google.accounts.id) {
    boot();
  } else if (attempt < 50) {
    setTimeout(() => waitForGis(attempt + 1), 100);
  } else {
    document.getElementById("signin-screen").hidden = false;
    document.getElementById("signin-status").textContent =
      "Could not load Google Sign-In. Check your connection and reload.";
  }
}

waitForGis();
