/**
 * Food Tracker — Google Apps Script Web App (thin JSON API over a Google Sheet).
 *
 * Deploy as a Web App: "Execute as: me", "Who has access: Anyone with the link".
 * Set one Script Property: SHARED_SECRET (a password of your choice).
 *
 * All requests are POST with Content-Type: text/plain and a JSON string body:
 *   { "action": "getFoods", "secret": "<your shared secret>", ...payload }
 * Responses are JSON: { ok:true, data:... } or { ok:false, error:"code" }.
 *
 * Design notes:
 *  - Columns are read by header name (no fixed column count) so the schema can grow.
 *  - Numbers are written as real JS numbers (never locale-formatted strings) to avoid
 *    the comma-decimal locale trap. Blank ("unknown") is stored as an empty cell, never 0.
 *  - Every request must carry the SHARED_SECRET; mismatches return { ok:false,
 *    error:"unauthorized" }. (Google Sign-In is preserved in git history.)
 *  - Writes are serialized with LockService to prevent interleaved appends.
 */

// ---- Sheet / schema constants -------------------------------------------------

var SHEETS = {
  Foods: ['id', 'name', 'name_es', 'name_free', 'kcal_100g', 'protein_100g', 'carbs_100g', 'fat_100g', 'serving_g', 'servings', 'created_at'],
  Meals: ['id', 'timestamp', 'note'],
  MealItems: ['id', 'meal_id', 'food_id', 'quantity_g'],
  Recipes: ['id', 'dish_id', 'food_id', 'quantity_g'],
  Settings: ['key', 'value']
};

var NUTRIENT_KEYS = ['kcal_100g', 'protein_100g', 'carbs_100g', 'fat_100g'];
var TARGET_KEYS = ['target_kcal', 'target_protein_g', 'target_carbs_g', 'target_fat_g'];

// ---- Entry points -------------------------------------------------------------

function doGet(e) {
  // Health check only. All real traffic is POST.
  return jsonOut({ ok: true, data: 'health ok' });
}

function doPost(e) {
  try {
    var payload;
    try {
      payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (parseErr) {
      return jsonOut({ ok: false, error: 'bad_request' });
    }

    var action = payload && payload.action;
    var handler = ACTIONS[action];
    if (!handler) return jsonOut({ ok: false, error: 'unknown_action' });

    // Auth on every request. Throws AuthError on failure.
    verify(payload);

    var data = handler(payload);
    return jsonOut({ ok: true, data: data });
  } catch (err) {
    if (err && err.name === 'AuthError') {
      return jsonOut({ ok: false, error: 'unauthorized' });
    }
    if (err && err.name === 'ClientError') {
      return jsonOut({ ok: false, error: err.code });
    }
    // Never leak raw exceptions to the client.
    return jsonOut({ ok: false, error: 'internal_error' });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Error helpers ------------------------------------------------------------

function AuthError() { this.name = 'AuthError'; }
function authFail() { throw new AuthError(); }

function ClientError(code) { this.name = 'ClientError'; this.code = code; }
function clientFail(code) { throw new ClientError(code); }

// ---- Auth: verify the shared secret -------------------------------------------

/**
 * Check the request's shared secret against SHARED_SECRET (Script Properties).
 * Throws AuthError on a missing/blank/mismatched secret. This is a personal
 * single-user MVP: the endpoint is reachable by "Anyone with the link", but every
 * request must carry the correct secret (sent in the POST body over HTTPS, never in
 * the URL). To restore Google Sign-In later, see git history.
 */
function verify(payload) {
  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!expected) authFail(); // misconfigured — fail closed

  var provided = payload && payload.secret;
  if (typeof provided !== 'string' || !constantTimeEquals(provided, expected)) {
    authFail();
  }
}

/** Length-safe string comparison (avoids leaking length via early exit). */
function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ---- Sheet access helpers (header-driven) -------------------------------------

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) clientFail('sheet_missing'); // run setupSheet() first
  return sh;
}

/** Read a sheet into { headers:[...], rows:[{header:value}, ...], sheet } (raw values). */
function readTable(name) {
  var sheet = getSheet(name);
  var values = sheet.getDataRange().getValues();
  var headers = (values[0] || []).map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var raw = values[r];
    if (isEmptyRow(raw)) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = raw[c];
    }
    obj.__row = r + 1; // 1-based sheet row for targeted writes
    rows.push(obj);
  }
  return { headers: headers, rows: rows, sheet: sheet };
}

function isEmptyRow(raw) {
  for (var i = 0; i < raw.length; i++) {
    if (raw[i] !== '' && raw[i] !== null && raw[i] !== undefined) return false;
  }
  return true;
}

function colIndex(headers, name) {
  var i = headers.indexOf(name);
  if (i < 0) clientFail('column_missing');
  return i;
}

/** Append one row given a { header: value } object, ordered by the sheet's headers. */
function appendRow(name, obj) {
  var sheet = getSheet(name);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var row = headers.map(function (h) {
    return obj.hasOwnProperty(h) ? obj[h] : '';
  });
  sheet.appendRow(row);
}

// ---- Value coercion -----------------------------------------------------------

/** Cell -> number | null. Empty cell means "unknown" (null); a real 0 stays 0. */
function cellToNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  var n = Number(String(v).replace(',', '.').trim());
  return isNaN(n) ? null : n;
}

/**
 * Normalize an incoming nutrition field from a JSON payload.
 * Returns { present, value }:
 *   - present:false  => field omitted -> leave existing value untouched (updates)
 *   - present:true, value:null   => explicit clear -> store empty cell ("unknown")
 *   - present:true, value:number => store the number (0 is a valid real value)
 * Throws client error for invalid (negative / non-numeric) values.
 */
function normNutrient(payload, field) {
  if (!payload.hasOwnProperty(field)) return { present: false, value: null };
  var v = payload[field];
  if (v === null || v === '' || v === undefined) return { present: true, value: null };
  var n = (typeof v === 'number') ? v : Number(String(v).replace(',', '.').trim());
  if (isNaN(n) || n < 0) clientFail('bad_nutrient');
  return { present: true, value: n };
}

function trimStr(v) { return v === null || v === undefined ? '' : String(v).trim(); }

/**
 * Normalize an incoming serving_g field. Same present/clear/set semantics as normNutrient,
 * but the value must be strictly positive (a 0 g serving is meaningless).
 */
function normServing(payload) {
  if (!payload.hasOwnProperty('serving_g')) return { present: false, value: null };
  var v = payload.serving_g;
  if (v === null || v === '' || v === undefined) return { present: true, value: null };
  var n = (typeof v === 'number') ? v : Number(String(v).replace(',', '.').trim());
  if (isNaN(n) || n <= 0) clientFail('bad_serving');
  return { present: true, value: n };
}

// ---- Concurrency --------------------------------------------------------------

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---- Food helpers -------------------------------------------------------------

function foodOut(row) {
  return {
    id: row.id,
    name: row.name,
    name_es: trimStr(row.name_es),
    name_free: trimStr(row.name_free),
    kcal_100g: cellToNum(row.kcal_100g),
    protein_100g: cellToNum(row.protein_100g),
    carbs_100g: cellToNum(row.carbs_100g),
    fat_100g: cellToNum(row.fat_100g),
    serving_g: cellToNum(row.serving_g),
    servings: cellToNum(row.servings)
  };
}

// A food/dish has three names: English (`name`, the primary), Spanish (`name_es`), and a
// free-form label (`name_free`). At least one must be non-empty. English stays the canonical
// name used for uniqueness and dedupe; the others are for finding/identifying the same food.

/** The three trimmed name fields of a row, in EN -> ES -> free order. */
function namesOf(row) {
  return [trimStr(row.name), trimStr(row.name_es), trimStr(row.name_free)];
}

/** The name to surface for a row: first non-empty (EN -> ES -> free), else '(unknown)'. */
function displayName(row) {
  var names = namesOf(row);
  for (var i = 0; i < names.length; i++) { if (names[i]) return names[i]; }
  return '(unknown)';
}

/**
 * Read the three name fields from a payload, each with present/value semantics like the
 * nutrient helpers (present:false => omitted; present:true => trimmed string, '' clears).
 */
function readNames(payload) {
  var keys = ['name', 'name_es', 'name_free'];
  var out = {};
  keys.forEach(function (k) {
    out[k] = payload.hasOwnProperty(k)
      ? { present: true, value: trimStr(payload[k]) }
      : { present: false, value: '' };
  });
  return out;
}

/** English-name exact match (case-insensitive). Used for uniqueness + createFood idempotency. */
function findFoodByName(rows, name) {
  var lower = String(name).trim().toLowerCase();
  if (!lower) return null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].name).trim().toLowerCase() === lower) return rows[i];
  }
  return null;
}

/** Match `value` against ANY of a row's three names. Used to resolve free-typed ingredients. */
function findFoodByAnyName(rows, value) {
  var lower = String(value).trim().toLowerCase();
  if (!lower) return null;
  for (var i = 0; i < rows.length; i++) {
    var names = namesOf(rows[i]);
    for (var j = 0; j < names.length; j++) {
      if (names[j].toLowerCase() === lower) return rows[i];
    }
  }
  return null;
}

function findFoodById(rows, id) {
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(id)) return rows[i];
  }
  return null;
}

/** Create a food (blank nutrition allowed) if the name is new; return its output row. */
function createFood(payload) {
  var names = readNames(payload);
  var name = names.name.value, nameEs = names.name_es.value, nameFree = names.name_free.value;
  if (!name && !nameEs && !nameFree) clientFail('bad_name'); // at least one name required

  var table = readTable('Foods');
  // Idempotency: an English name that already exists returns the existing food unchanged.
  if (name) {
    var existing = findFoodByName(table.rows, name);
    if (existing) return foodOut(existing);
  }

  var kcal = normNutrient(payload, 'kcal_100g');
  var protein = normNutrient(payload, 'protein_100g');
  var carbs = normNutrient(payload, 'carbs_100g');
  var fat = normNutrient(payload, 'fat_100g');
  var serving = normServing(payload);

  var id = Utilities.getUuid();
  appendRow('Foods', {
    id: id,
    name: name,
    name_es: nameEs,
    name_free: nameFree,
    kcal_100g: kcal.present && kcal.value !== null ? kcal.value : '',
    protein_100g: protein.present && protein.value !== null ? protein.value : '',
    carbs_100g: carbs.present && carbs.value !== null ? carbs.value : '',
    fat_100g: fat.present && fat.value !== null ? fat.value : '',
    serving_g: serving.present && serving.value !== null ? serving.value : '',
    created_at: new Date().toISOString()
  });

  return {
    id: id,
    name: name,
    name_es: nameEs,
    name_free: nameFree,
    kcal_100g: kcal.present ? kcal.value : null,
    protein_100g: protein.present ? protein.value : null,
    carbs_100g: carbs.present ? carbs.value : null,
    fat_100g: fat.present ? fat.value : null,
    serving_g: serving.present ? serving.value : null
  };
}

// ---- Actions ------------------------------------------------------------------

var ACTIONS = {
  getBootstrap: getBootstrap,
  getFoods: getFoods,
  addFood: addFood,
  updateFood: updateFood,
  addDish: addDish,
  updateDish: updateDish,
  addMeal: addMeal,
  updateMeal: updateMeal,
  deleteMeal: deleteMeal,
  getMeals: getMeals,
  getSettings: getSettings,
  updateSettings: updateSettings
};

// One-shot startup payload: foods + settings + a recent window of meals, so the client
// loads everything in a single request instead of three separate round trips. Composes the
// existing handlers (one script invocation reads each sheet once).
function getBootstrap(payload) {
  var limit = parseInt(payload && payload.limit, 10);
  if (isNaN(limit) || limit <= 0) limit = 100;
  var mealsResult = getMeals({ limit: limit });
  return {
    foods: getFoods().foods,
    settings: getSettings().settings,
    meals: mealsResult.meals,
    hasMore: mealsResult.hasMore,
    nextBefore: mealsResult.nextBefore,
    recipes: getRecipesSafe()
  };
}

/** All Recipes rows, or [] if the Recipes tab doesn't exist yet (setupSheet not re-run). */
function getRecipesSafe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName('Recipes')) return [];
  return readTable('Recipes').rows.map(function (r) {
    return { dish_id: String(r.dish_id), food_id: String(r.food_id), quantity_g: cellToNum(r.quantity_g) };
  });
}

function getFoods() {
  var table = readTable('Foods');
  return { foods: table.rows.map(foodOut) };
}

function addFood(payload) {
  return withLock(function () {
    return createFood(payload);
  });
}

function updateFood(payload) {
  return withLock(function () {
    var id = trimStr(payload.id);
    if (!id) clientFail('bad_request');

    var table = readTable('Foods');
    var target = findFoodById(table.rows, id);
    if (!target) clientFail('not_found');

    var updates = {}; // header -> value to write

    // Names: each of the three is independently settable/clearable. At least one must remain
    // non-empty; English (`name`) alone must stay unique.
    var names = readNames(payload);
    var effName = names.name.present ? names.name.value : trimStr(target.name);
    var effEs = names.name_es.present ? names.name_es.value : trimStr(target.name_es);
    var effFree = names.name_free.present ? names.name_free.value : trimStr(target.name_free);
    if (!effName && !effEs && !effFree) clientFail('bad_name');
    if (names.name.present) {
      if (effName) {
        var collision = findFoodByName(table.rows, effName);
        if (collision && String(collision.id) !== id) clientFail('name_taken');
      }
      updates.name = effName;
    }
    if (names.name_es.present) updates.name_es = effEs;
    if (names.name_free.present) updates.name_free = effFree;

    NUTRIENT_KEYS.forEach(function (field) {
      var n = normNutrient(payload, field);
      if (!n.present) return;                 // omitted -> leave as-is
      updates[field] = n.value === null ? '' : n.value; // null -> clear, number -> set (0 ok)
    });

    var serving = normServing(payload);
    if (serving.present) updates.serving_g = serving.value === null ? '' : serving.value;

    // Write changed cells individually so numbers stay numbers (locale-safe).
    var sheet = table.sheet;
    Object.keys(updates).forEach(function (header) {
      var c = colIndex(table.headers, header) + 1;
      sheet.getRange(target.__row, c).setValue(updates[header]);
    });

    // Re-read the row to return canonical values.
    var refreshed = readTable('Foods');
    return foodOut(findFoodById(refreshed.rows, id));
  });
}

// ---- Dishes (a dish is a Foods row + a recipe in the Recipes tab) --------------

/** Validate an optional positive `servings` value. Returns { present, value }. */
function normServings(payload) {
  if (!payload.hasOwnProperty('servings')) return { present: false, value: null };
  var v = payload.servings;
  if (v === null || v === '' || v === undefined) return { present: true, value: null };
  var n = (typeof v === 'number') ? v : Number(String(v).replace(',', '.').trim());
  if (isNaN(n) || n <= 0) clientFail('bad_servings');
  return { present: true, value: n };
}

/** Row numbers (1-based) of Recipes belonging to a dish, plus the sheet. */
function recipeRows(dishId) {
  var table = readTable('Recipes');
  var rows = [];
  table.rows.forEach(function (r) { if (String(r.dish_id) === String(dishId)) rows.push(r.__row); });
  return { sheet: table.sheet, rows: rows };
}

/** Write Recipes rows for a dish from resolved ingredients. */
function writeRecipe(dishId, resolved) {
  var out = [];
  for (var i = 0; i < resolved.length; i++) {
    appendRow('Recipes', {
      id: Utilities.getUuid(), dish_id: dishId,
      food_id: resolved[i].food_id, quantity_g: resolved[i].quantity_g
    });
    out.push({ food_id: resolved[i].food_id, name: resolved[i].name, quantity_g: resolved[i].quantity_g });
  }
  return out;
}

function addDish(payload) {
  return withLock(function () {
    var names = readNames(payload);
    var name = names.name.value, nameEs = names.name_es.value, nameFree = names.name_free.value;
    if (!name && !nameEs && !nameFree) clientFail('bad_name'); // at least one name required
    if (!payload.ingredients || !payload.ingredients.length) clientFail('empty_dish');

    var foodTable = readTable('Foods');
    if (name && findFoodByName(foodTable.rows, name)) clientFail('name_taken');

    var servings = normServings(payload);

    // The dish itself is a food with blank nutrition (per-100g is computed client-side).
    var dishId = Utilities.getUuid();
    appendRow('Foods', {
      id: dishId, name: name, name_es: nameEs, name_free: nameFree,
      kcal_100g: '', protein_100g: '', carbs_100g: '', fat_100g: '', serving_g: '',
      servings: servings.present && servings.value !== null ? servings.value : '',
      created_at: new Date().toISOString()
    });
    // so an ingredient can't dedupe to the dish (matched by any of its names)
    foodTable.rows.push({ id: dishId, name: name, name_es: nameEs, name_free: nameFree });

    var resolved = resolveMealItems(payload.ingredients, foodTable);
    var outItems = writeRecipe(dishId, resolved);
    return {
      id: dishId, name: name, name_es: nameEs, name_free: nameFree,
      servings: servings.value, ingredients: outItems
    };
  });
}

function updateDish(payload) {
  return withLock(function () {
    var id = trimStr(payload.id);
    if (!id) clientFail('bad_request');

    var foodTable = readTable('Foods');
    var target = findFoodById(foodTable.rows, id);
    if (!target) clientFail('not_found');
    var sheet = foodTable.sheet;

    // Names (three fields): at least one non-empty; English alone stays unique.
    var names = readNames(payload);
    var effName = names.name.present ? names.name.value : trimStr(target.name);
    var effEs = names.name_es.present ? names.name_es.value : trimStr(target.name_es);
    var effFree = names.name_free.present ? names.name_free.value : trimStr(target.name_free);
    if (!effName && !effEs && !effFree) clientFail('bad_name');
    if (names.name.present) {
      if (effName) {
        var collision = findFoodByName(foodTable.rows, effName);
        if (collision && String(collision.id) !== id) clientFail('name_taken');
      }
      sheet.getRange(target.__row, colIndex(foodTable.headers, 'name') + 1).setValue(effName);
    }
    if (names.name_es.present) {
      sheet.getRange(target.__row, colIndex(foodTable.headers, 'name_es') + 1).setValue(effEs);
    }
    if (names.name_free.present) {
      sheet.getRange(target.__row, colIndex(foodTable.headers, 'name_free') + 1).setValue(effFree);
    }
    var servings = normServings(payload);
    if (servings.present) {
      sheet.getRange(target.__row, colIndex(foodTable.headers, 'servings') + 1)
        .setValue(servings.value === null ? '' : servings.value);
    }

    var outItems = null;
    if (payload.hasOwnProperty('ingredients')) {
      if (!payload.ingredients || !payload.ingredients.length) clientFail('empty_dish');
      var resolved = resolveMealItems(payload.ingredients, readTable('Foods'));
      var old = recipeRows(id);
      deleteRows(old.sheet, old.rows);
      outItems = writeRecipe(id, resolved);
    }

    var refreshed = findFoodById(readTable('Foods').rows, id);
    if (outItems === null) {
      var foodNameById = {};
      readTable('Foods').rows.forEach(function (f) { foodNameById[String(f.id)] = displayName(f); });
      outItems = recipeRows(id).rows.length
        ? readTable('Recipes').rows.filter(function (r) { return String(r.dish_id) === id; })
            .map(function (r) {
              return { food_id: String(r.food_id), name: foodNameById[String(r.food_id)] || '(unknown)', quantity_g: cellToNum(r.quantity_g) };
            })
        : [];
    }
    return {
      id: id, name: String(refreshed.name),
      name_es: trimStr(refreshed.name_es), name_free: trimStr(refreshed.name_free),
      servings: cellToNum(refreshed.servings), ingredients: outItems
    };
  });
}

/**
 * Resolve meal-item inputs to concrete foods, creating new foods (blank nutrition) for any
 * `food_name` not yet in the catalog. Returns [{food_id, name, quantity_g}]. Shared by
 * addMeal and updateMeal. `foodTable` is a readTable('Foods') result (mutated so repeated
 * new names within one request dedupe).
 */
function resolveMealItems(items, foodTable) {
  var resolved = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var qty = (typeof it.quantity_g === 'number')
      ? it.quantity_g
      : Number(String(it.quantity_g).replace(',', '.').trim());
    if (isNaN(qty) || qty <= 0) clientFail('bad_quantity');

    var foodRow = null;
    if (it.food_id) {
      foodRow = findFoodById(foodTable.rows, it.food_id);
    }
    if (!foodRow && it.food_name) {
      foodRow = findFoodByAnyName(foodTable.rows, it.food_name);
      if (!foodRow) {
        var created = createFood({ name: it.food_name }); // typed text -> English name, blank nutrition
        foodRow = { id: created.id, name: created.name, name_es: created.name_es, name_free: created.name_free };
        foodTable.rows.push(foodRow); // so repeated new names in one meal dedupe
      }
    }
    if (!foodRow) clientFail('unknown_food');

    resolved.push({ food_id: foodRow.id, name: displayName(foodRow), quantity_g: qty });
  }
  return resolved;
}

/** Append MealItems rows for `resolved` items under `mealId`; return them as output items. */
function writeMealItems(mealId, resolved) {
  var outItems = [];
  for (var j = 0; j < resolved.length; j++) {
    var itemId = Utilities.getUuid();
    appendRow('MealItems', {
      id: itemId,
      meal_id: mealId,
      food_id: resolved[j].food_id,
      quantity_g: resolved[j].quantity_g
    });
    outItems.push({
      id: itemId,
      food_id: resolved[j].food_id,
      name: resolved[j].name,
      quantity_g: resolved[j].quantity_g
    });
  }
  return outItems;
}

/** Delete the given 1-based row numbers from a sheet (descending so indices don't shift). */
function deleteRows(sheet, rowNums) {
  rowNums.slice().sort(function (a, b) { return b - a; }).forEach(function (n) {
    sheet.deleteRow(n);
  });
}

/** Row numbers (1-based) of MealItems belonging to a meal. */
function mealItemRows(mealId) {
  var table = readTable('MealItems');
  var rows = [];
  table.rows.forEach(function (r) {
    if (String(r.meal_id) === String(mealId)) rows.push(r.__row);
  });
  return { sheet: table.sheet, rows: rows };
}

function addMeal(payload) {
  return withLock(function () {
    var items = payload.items;
    if (!items || !items.length) clientFail('empty_meal');

    var timestamp = trimStr(payload.timestamp);
    if (!timestamp) timestamp = new Date().toISOString();
    var note = trimStr(payload.note);

    var foodTable = readTable('Foods');
    var resolved = resolveMealItems(items, foodTable);

    // Append the meal, then its items.
    var mealId = Utilities.getUuid();
    appendRow('Meals', { id: mealId, timestamp: timestamp, note: note });
    var outItems = writeMealItems(mealId, resolved);

    return { id: mealId, timestamp: timestamp, note: note, items: outItems };
  });
}

function deleteMeal(payload) {
  return withLock(function () {
    var id = trimStr(payload.id);
    if (!id) clientFail('bad_request');

    var mealTable = readTable('Meals');
    var meal = mealTable.rows.filter(function (r) { return String(r.id) === id; })[0];
    if (!meal) clientFail('not_found');

    var items = mealItemRows(id);
    deleteRows(items.sheet, items.rows);
    mealTable.sheet.deleteRow(meal.__row);
    return { id: id };
  });
}

function updateMeal(payload) {
  return withLock(function () {
    var id = trimStr(payload.id);
    if (!id) clientFail('bad_request');

    var mealTable = readTable('Meals');
    var meal = mealTable.rows.filter(function (r) { return String(r.id) === id; })[0];
    if (!meal) clientFail('not_found');
    var sheet = mealTable.sheet;

    // Replace items if provided: resolve, delete old MealItems, write new ones.
    var outItems = null;
    if (payload.hasOwnProperty('items')) {
      if (!payload.items || !payload.items.length) clientFail('empty_meal');
      var resolved = resolveMealItems(payload.items, readTable('Foods'));
      var old = mealItemRows(id);
      deleteRows(old.sheet, old.rows);
      outItems = writeMealItems(id, resolved);
    }

    // Update timestamp / note cells when present.
    if (payload.hasOwnProperty('timestamp')) {
      var ts = trimStr(payload.timestamp) || new Date().toISOString();
      sheet.getRange(meal.__row, colIndex(mealTable.headers, 'timestamp') + 1).setValue(ts);
    }
    if (payload.hasOwnProperty('note')) {
      sheet.getRange(meal.__row, colIndex(mealTable.headers, 'note') + 1).setValue(trimStr(payload.note));
    }

    // Return the canonical, updated meal (re-read row; attach items).
    var refreshed = readTable('Meals').rows.filter(function (r) { return String(r.id) === id; })[0];
    if (outItems === null) {
      var foodNameById = {};
      readTable('Foods').rows.forEach(function (f) { foodNameById[String(f.id)] = displayName(f); });
      outItems = mealItemRows(id).rows.length
        ? readTable('MealItems').rows
            .filter(function (r) { return String(r.meal_id) === id; })
            .map(function (r) {
              return { id: String(r.id), food_id: String(r.food_id),
                name: foodNameById[String(r.food_id)] || '(unknown)', quantity_g: cellToNum(r.quantity_g) };
            })
        : [];
    }
    return {
      id: id,
      timestamp: tsToIso(refreshed.timestamp),
      note: refreshed.note === '' ? '' : String(refreshed.note),
      items: outItems
    };
  });
}

function getMeals(payload) {
  var limit = parseInt(payload.limit, 10);
  if (isNaN(limit) || limit <= 0) limit = 20;
  var before = trimStr(payload.before); // ISO cursor; return meals strictly before this

  var mealTable = readTable('Meals');
  var meals = mealTable.rows.map(function (r) {
    return { id: String(r.id), timestamp: tsToIso(r.timestamp), note: r.note === '' ? '' : String(r.note) };
  });

  // Newest first.
  meals.sort(function (a, b) { return a.timestamp < b.timestamp ? 1 : (a.timestamp > b.timestamp ? -1 : 0); });

  if (before) {
    meals = meals.filter(function (m) { return m.timestamp < before; });
  }

  var hasMore = meals.length > limit;
  var page = meals.slice(0, limit);

  // Attach items (with resolved food names) only for the returned page.
  var ids = {};
  page.forEach(function (m) { ids[m.id] = m; m.items = []; });

  var foodTable = readTable('Foods');
  var foodNameById = {};
  foodTable.rows.forEach(function (f) { foodNameById[String(f.id)] = displayName(f); });

  var itemTable = readTable('MealItems');
  itemTable.rows.forEach(function (row) {
    var m = ids[String(row.meal_id)];
    if (!m) return;
    m.items.push({
      food_id: String(row.food_id),
      name: foodNameById[String(row.food_id)] || '(unknown)',
      quantity_g: cellToNum(row.quantity_g)
    });
  });

  var nextBefore = page.length ? page[page.length - 1].timestamp : null;
  return { meals: page, hasMore: hasMore, nextBefore: nextBefore };
}

function getSettings() {
  var table = readTable('Settings');
  var settings = {};
  table.rows.forEach(function (r) {
    settings[String(r.key)] = (r.value === '' || r.value === null || r.value === undefined)
      ? null
      : r.value;
  });
  // Ensure the four target keys are always present (null if unset).
  TARGET_KEYS.forEach(function (k) {
    if (!settings.hasOwnProperty(k)) settings[k] = null;
  });
  return { settings: settings };
}

function updateSettings(payload) {
  return withLock(function () {
    var table = readTable('Settings');
    var sheet = table.sheet;
    var byKey = {};
    table.rows.forEach(function (r) { byKey[String(r.key)] = r; });

    TARGET_KEYS.forEach(function (key) {
      if (!payload.hasOwnProperty(key)) return; // omitted -> leave as-is
      var raw = payload[key];
      var value;
      if (raw === null || raw === '' || raw === undefined) {
        value = ''; // clear
      } else {
        var n = (typeof raw === 'number') ? raw : Number(String(raw).replace(',', '.').trim());
        if (isNaN(n) || n < 0) clientFail('bad_target');
        value = n;
      }
      var existing = byKey[key];
      if (existing) {
        var c = colIndex(table.headers, 'value') + 1;
        sheet.getRange(existing.__row, c).setValue(value);
      } else {
        appendRow('Settings', { key: key, value: value });
      }
    });

    return getSettings();
  });
}

// ---- Timestamp helper ---------------------------------------------------------

/** A cell may hold a Date (if the sheet auto-parsed) or a string; normalize to ISO. */
function tsToIso(v) {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// ---- One-time setup (run manually from the editor) ----------------------------

/**
 * Create the four tabs with their header rows if missing. Idempotent — safe to re-run.
 * Run this once from the Apps Script editor after pasting the code.
 */
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var headers = SHEETS[name];
    var firstRow = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    var hasHeaders = firstRow.some(function (c) { return c !== '' && c !== null; });
    if (!hasHeaders) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    } else {
      // Existing tab: append any schema columns it doesn't have yet (e.g. serving_g added
      // in a later version). Reads are header-driven, so appended position is fine.
      var existing = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
        .map(function (h) { return String(h).trim(); });
      headers.forEach(function (h) {
        if (existing.indexOf(h) === -1) {
          sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
          existing.push(h);
        }
      });
    }
  });
  // Remove the default "Sheet1" if it is empty and not one of ours.
  var def = ss.getSheetByName('Sheet1');
  if (def && !SHEETS.hasOwnProperty('Sheet1') && def.getLastRow() === 0) {
    ss.deleteSheet(def);
  }
  return 'setup complete';
}

/**
 * Bulk-import food names. Runs as the sheet owner from the editor (no OAuth needed).
 *
 * Source: a temporary tab named "Import" with food names in column A (one per row,
 * an optional header "name" in A1 is skipped). New names are appended to Foods with
 * blank nutrition; existing names (case-insensitive) are skipped. See
 * tools/import_foods_notes.md for the CSV workflow.
 */
function importFoods() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName('Import');
  if (!src) throw new Error('Create a tab named "Import" with food names in column A.');

  var values = src.getRange(1, 1, Math.max(src.getLastRow(), 1), 1).getValues();
  var table = readTable('Foods');
  var seen = {};
  table.rows.forEach(function (r) { seen[String(r.name).trim().toLowerCase()] = true; });

  var added = 0, skipped = 0;
  for (var i = 0; i < values.length; i++) {
    var name = trimStr(values[i][0]);
    if (!name) continue;
    if (i === 0 && name.toLowerCase() === 'name') continue; // skip header
    var lower = name.toLowerCase();
    if (seen[lower]) { skipped++; continue; }
    seen[lower] = true;
    appendRow('Foods', {
      id: Utilities.getUuid(),
      name: name,
      kcal_100g: '', protein_100g: '', carbs_100g: '', fat_100g: '',
      created_at: new Date().toISOString()
    });
    added++;
  }
  return 'imported ' + added + ' foods, skipped ' + skipped + ' existing';
}
