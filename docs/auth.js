// auth.js — Google Identity Services (GIS) sign-in.
//
// Flow:
//  - init() sets up GIS with the Client ID and attempts One Tap (silent for returning
//    users with an active Google session). If One Tap can't complete, it renders the
//    standard "Sign in with Google" button on the sign-in screen.
//  - The ID token is kept in memory only (never localStorage).
//  - refreshToken() re-prompts GIS to obtain a fresh token (used on token expiry).

import { GOOGLE_CLIENT_ID } from "./config.js";

let idToken = null;
let email = null;
let onSignedIn = null; // callback fired once, when we first get a valid token

// Promises awaiting the *next* fresh token (used by refreshToken()).
let pendingResolvers = [];

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch (_) {
    return {};
  }
}

// GIS calls this with a credential (ID token) on any successful sign-in / refresh.
function handleCredential(response) {
  idToken = response.credential;
  const claims = decodeJwtPayload(idToken);
  email = claims.email || null;

  // Resolve anyone waiting on a refresh.
  const waiters = pendingResolvers;
  pendingResolvers = [];
  waiters.forEach((r) => r(idToken));

  if (onSignedIn) {
    const cb = onSignedIn;
    onSignedIn = null;
    cb();
  }
}

export function init({ onFirstSignIn, statusEl, buttonEl }) {
  onSignedIn = onFirstSignIn;

  if (!window.google || !google.accounts || !google.accounts.id) {
    if (statusEl) statusEl.textContent =
      "Could not load Google Sign-In. Check your connection and reload.";
    return;
  }

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleCredential,
    auto_select: true,            // silent sign-in for returning users
    use_fedcm_for_prompt: true,   // opt into FedCM (One Tap status methods are deprecated)
    cancel_on_tap_outside: false,
  });

  // Always render the button so there's a reliable fallback if One Tap doesn't show.
  if (buttonEl) {
    google.accounts.id.renderButton(buttonEl, {
      type: "standard",
      theme: "filled_blue",
      size: "large",
      text: "signin_with",
      shape: "pill",
    });
  }

  if (statusEl) statusEl.textContent = "…or use One Tap if it appears.";

  // Attempt One Tap. We don't inspect the prompt moment (those status methods are
  // deprecated under FedCM); the rendered button covers every fallback case.
  google.accounts.id.prompt();
}

export function getToken() {
  return idToken;
}

export function getEmail() {
  return email;
}

export function isSignedIn() {
  return !!idToken;
}

// Returns the number of seconds until the current token expires (or 0 if unknown/expired).
export function secondsUntilExpiry() {
  if (!idToken) return 0;
  const { exp } = decodeJwtPayload(idToken);
  if (!exp) return 0;
  return Math.max(0, exp - Math.floor(Date.now() / 1000));
}

// Re-prompt GIS for a fresh token. Resolves with the new token, or rejects on timeout.
export function refreshToken() {
  return new Promise((resolve, reject) => {
    pendingResolvers.push(resolve);

    const timer = setTimeout(() => {
      // Remove our resolver if still pending.
      pendingResolvers = pendingResolvers.filter((r) => r !== resolve);
      reject(new Error("token_refresh_timeout"));
    }, 15000);

    // Wrap resolve so we clear the timer.
    const idx = pendingResolvers.indexOf(resolve);
    pendingResolvers[idx] = (tok) => {
      clearTimeout(timer);
      resolve(tok);
    };

    if (window.google && google.accounts && google.accounts.id) {
      google.accounts.id.prompt();
    }
  });
}

export function signOut() {
  idToken = null;
  email = null;
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }
  location.reload();
}
