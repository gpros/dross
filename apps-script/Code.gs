/**
 * Food Tracker — Google Apps Script Web App (thin JSON API over a Google Sheet).
 *
 * Deploy as a Web App: "Execute as: me", "Who has access: Anyone with the link".
 * Set Script Properties: CLIENT_ID (OAuth Web Client ID) and ALLOWED_EMAIL (your Gmail).
 *
 * All requests are POST with Content-Type: text/plain and a JSON string body:
 *   { "action": "getFoods", "id_token": "<google id token>", ...payload }
 * Responses are JSON: { ok:true, data:... } or { ok:false, error:"code" }.
 *
 * Design notes:
 *  - Columns are read by header name (no fixed column count) so the schema can grow.
 *  - Numbers are written as real JS numbers (never locale-formatted strings) to avoid
 *    the comma-decimal locale trap. Blank ("unknown") is stored as an empty cell, never 0.
 *  - Every request verifies the caller's Google ID token against ALLOWED_EMAIL.
 *  - Writes are serialized with LockService to prevent interleaved appends.
 */

// ---- Sheet / schema constants -------------------------------------------------

var SHEETS = {
  Foods: ['id', 'name', 'kcal_100g', 'protein_100g', 'carbs_100g', 'fat_100g', 'created_at'],
  Meals: ['id', 'timestamp', 'note'],
  MealItems: ['id', 'meal_id', 'food_id', 'quantity_g'],
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
    var claims = verify(payload.id_token);

    var data = handler(payload, claims);
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

// ---- Auth: verify Google ID token ---------------------------------------------

/**
 * Verify a Google ID token and return its claims. Throws AuthError on any failure.
 * Successful verifications are cached (keyed by a hash of the token) for the token's
 * remaining lifetime, so repeated requests in a session verify locally.
 */
function verify(idToken) {
  if (!idToken || typeof idToken !== 'string') authFail();

  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('CLIENT_ID');
  var allowedEmail = props.getProperty('ALLOWED_EMAIL');
  if (!clientId || !allowedEmail) authFail(); // misconfigured — fail closed

  var cache = CacheService.getScriptCache();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken);
  var key = 'tok_' + bytesToHex(digest);

  var cached = cache.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  var resp;
  try {
    resp = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
  } catch (fetchErr) {
    authFail();
  }
  if (resp.getResponseCode() !== 200) authFail();

  var info;
  try {
    info = JSON.parse(resp.getContentText());
  } catch (jsonErr) {
    authFail();
  }

  var nowSec = Math.floor(Date.now() / 1000);
  var exp = parseInt(info.exp, 10);
  var okAud = info.aud === clientId;
  var okEmail = (info.email || '').toLowerCase() === allowedEmail.toLowerCase();
  var okVerified = String(info.email_verified) === 'true';
  var okExp = exp && exp > nowSec;

  if (!(okAud && okEmail && okVerified && okExp)) authFail();

  var claims = { email: info.email, sub: info.sub, exp: exp };
  var ttl = Math.min(exp - nowSec, 3600); // CacheService max 6h; token life ~1h
  if (ttl > 0) cache.put(key, JSON.stringify(claims), ttl);
  return claims;
}

function bytesToHex(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
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
    kcal_100g: cellToNum(row.kcal_100g),
    protein_100g: cellToNum(row.protein_100g),
    carbs_100g: cellToNum(row.carbs_100g),
    fat_100g: cellToNum(row.fat_100g)
  };
}

function findFoodByName(rows, name) {
  var lower = String(name).trim().toLowerCase();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].name).trim().toLowerCase() === lower) return rows[i];
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
  var name = trimStr(payload.name);
  if (!name) clientFail('bad_name');

  var table = readTable('Foods');
  var existing = findFoodByName(table.rows, name);
  if (existing) return foodOut(existing); // idempotent

  var kcal = normNutrient(payload, 'kcal_100g');
  var protein = normNutrient(payload, 'protein_100g');
  var carbs = normNutrient(payload, 'carbs_100g');
  var fat = normNutrient(payload, 'fat_100g');

  var id = Utilities.getUuid();
  appendRow('Foods', {
    id: id,
    name: name,
    kcal_100g: kcal.present && kcal.value !== null ? kcal.value : '',
    protein_100g: protein.present && protein.value !== null ? protein.value : '',
    carbs_100g: carbs.present && carbs.value !== null ? carbs.value : '',
    fat_100g: fat.present && fat.value !== null ? fat.value : '',
    created_at: new Date().toISOString()
  });

  return {
    id: id,
    name: name,
    kcal_100g: kcal.present ? kcal.value : null,
    protein_100g: protein.present ? protein.value : null,
    carbs_100g: carbs.present ? carbs.value : null,
    fat_100g: fat.present ? fat.value : null
  };
}

// ---- Actions ------------------------------------------------------------------

var ACTIONS = {
  getFoods: getFoods,
  addFood: addFood,
  updateFood: updateFood,
  addMeal: addMeal,
  getMeals: getMeals,
  getSettings: getSettings,
  updateSettings: updateSettings
};

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

    if (payload.hasOwnProperty('name')) {
      var newName = trimStr(payload.name);
      if (!newName) clientFail('bad_name');
      var collision = findFoodByName(table.rows, newName);
      if (collision && String(collision.id) !== id) clientFail('name_taken');
      updates.name = newName;
    }

    NUTRIENT_KEYS.forEach(function (field) {
      var n = normNutrient(payload, field);
      if (!n.present) return;                 // omitted -> leave as-is
      updates[field] = n.value === null ? '' : n.value; // null -> clear, number -> set (0 ok)
    });

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

function addMeal(payload) {
  return withLock(function () {
    var items = payload.items;
    if (!items || !items.length) clientFail('empty_meal');

    var timestamp = trimStr(payload.timestamp);
    if (!timestamp) timestamp = new Date().toISOString();
    var note = trimStr(payload.note);

    var foodTable = readTable('Foods');

    // Resolve every item to a food_id, creating new foods (blank nutrition) as needed.
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
        foodRow = findFoodByName(foodTable.rows, it.food_name);
        if (!foodRow) {
          var created = createFood({ name: it.food_name }); // blank nutrition
          foodRow = { id: created.id, name: created.name };
          foodTable.rows.push(foodRow); // so repeated new names in one meal dedupe
        }
      }
      if (!foodRow) clientFail('unknown_food');

      resolved.push({ food_id: foodRow.id, name: foodRow.name, quantity_g: qty });
    }

    // Append the meal, then its items.
    var mealId = Utilities.getUuid();
    appendRow('Meals', { id: mealId, timestamp: timestamp, note: note });

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

    return { id: mealId, timestamp: timestamp, note: note, items: outItems };
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
  foodTable.rows.forEach(function (f) { foodNameById[String(f.id)] = String(f.name); });

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
