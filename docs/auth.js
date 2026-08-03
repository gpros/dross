// auth.js — shared-secret "sign in". No Google, no tokens.
//
// The user enters a password once; it's kept in memory and mirrored to localStorage so
// they don't re-enter it on every visit. Every API request carries this secret. If the
// server rejects it (wrong/changed password), we clear it and re-prompt.

import { el } from "./ui.js";

const STORAGE_KEY = "ft_secret";

let secret = null;

// Hydrate from localStorage on load.
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) secret = stored;
} catch (_) {
  /* localStorage unavailable (private mode) — fall back to in-memory only */
}

export function getSecret() {
  return secret;
}

export function hasSecret() {
  return !!secret;
}

function setSecret(value) {
  secret = value;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch (_) {
    /* ignore — in-memory still works for this session */
  }
}

export function clearSecret() {
  secret = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

// A label for the account footer. There's no real identity — just the device.
export function getEmail() {
  return "this device";
}

export function signOut() {
  clearSecret();
  location.reload();
}

// Render the password screen into the sign-in container and resolve onUnlock once the
// user submits a non-empty password. `message` optionally explains a re-prompt.
export function promptForSecret({ container, onUnlock, message = "" }) {
  const input = el("input", {
    type: "password",
    inputmode: "text",
    autocomplete: "current-password",
    placeholder: "Password",
    "aria-label": "Password",
  });
  const status = el("p", { class: "muted small", role: "status", "aria-live": "polite", text: message });
  const button = el("button", { class: "btn primary block", text: "Continue" });

  function submit() {
    const value = input.value.trim();
    if (!value) {
      status.textContent = "Enter your password to continue.";
      input.focus();
      return;
    }
    setSecret(value);
    onUnlock();
  }

  button.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  const card = el("div", { class: "signin-card" }, [
    el("div", { class: "signin-logo", "aria-hidden": "true", text: "🍽️" }),
    el("h1", { text: "Food Tracker" }),
    el("p", { class: "muted", text: "Enter your password to continue." }),
    input,
    el("div", { style: "height:12px" }),
    button,
    status,
  ]);

  // Clear the container and show the card.
  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(card);
  container.hidden = false;
  input.focus();
}
