// api.js — thin fetch wrapper around the Apps Script Web App.
//
// All requests are POST with Content-Type: text/plain (avoids a CORS preflight) and a
// JSON string body carrying { action, id_token, ...payload }. On an `unauthorized`
// response we silently refresh the ID token and retry once, so an in-progress action
// (e.g. saving a meal) is never lost to token expiry.

import { API_URL } from "./config.js";
import { getToken, refreshToken } from "./auth.js";

export class ApiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

async function rawPost(action, payload) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, id_token: getToken(), ...payload }),
    });
  } catch (networkErr) {
    throw new ApiError("network", "Network error — check your connection.");
  }

  if (!res.ok) {
    throw new ApiError("http_" + res.status, "Server returned " + res.status);
  }

  let json;
  try {
    json = await res.json();
  } catch (parseErr) {
    throw new ApiError("bad_response", "Malformed server response.");
  }
  return json;
}

/**
 * Perform an action. On `unauthorized`, refresh the token and retry exactly once.
 * Returns the `data` field on success; throws ApiError otherwise.
 */
export async function postAction(action, payload = {}) {
  let json = await rawPost(action, payload);

  if (!json.ok && json.error === "unauthorized") {
    try {
      await refreshToken();
    } catch (_) {
      throw new ApiError("unauthorized", "Your session expired. Please sign in again.");
    }
    json = await rawPost(action, payload); // retry once with the fresh token
  }

  if (!json.ok) {
    throw new ApiError(json.error || "error", messageFor(json.error));
  }
  return json.data;
}

function messageFor(code) {
  switch (code) {
    case "unauthorized": return "Your session expired. Please sign in again.";
    case "name_taken": return "A food with that name already exists.";
    case "bad_nutrient": return "Nutrition values must be zero or positive numbers.";
    case "bad_target": return "Targets must be zero or positive numbers.";
    case "bad_quantity": return "Quantity must be a positive number of grams.";
    case "empty_meal": return "Add at least one item to the meal.";
    case "sheet_missing": return "The spreadsheet isn't set up yet (run setupSheet).";
    default: return "Something went wrong. Please try again.";
  }
}

// ---- Named endpoint wrappers ----

export const getFoods = () => postAction("getFoods");
export const addFood = (food) => postAction("addFood", food);
export const updateFood = (patch) => postAction("updateFood", patch);
export const addMeal = (meal) => postAction("addMeal", meal);
export const getMeals = (opts = {}) => postAction("getMeals", opts);
export const getSettings = () => postAction("getSettings");
export const updateSettings = (targets) => postAction("updateSettings", targets);
