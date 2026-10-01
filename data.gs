// ═══════════════════════════════════════════════════════════════════════
// WANNASMILE — DATA  (data.gs)
// Site content, accounts and internal plumbing. One of three projects:
//   DATA (this)  assets, devbuild, quotes, sync, tickets
//   CUST         themes, widgets, banners, gif packs   (cust.gs)
//   MOD          word filter, taken usernames         (mod.gs)
// The site's copy of the three URLs: system/js/endpoints.js.
//
// Sheets (tabs in the spreadsheet this script is bound to):
//   AssetBuilderWS    ?type=assets (default), ?type=asset, POST (token)
//                     ?type=discovery: assets + average rating (column L),
//                     POST type=rate (approved ticket + key, once per asset)
//   RatingLogWS       who rated what (made on the first rating)
//   DevBuildWS        ?type=devbuild, POST (token)
//   QuoteSystemWS     ?type=quotes (col A), ?type=searchquotes (col B)
//   QRWS              ?type=qr (col A)
//   SystemDataSyncWS  ?type=sync, POST (token)
//   ContribWS         ?type=contrib  who may open the debug panel (devtools.js).
//                     Columns: TicketID | Username | Note (ignored). A ticket is
//                     a contributor when its TicketID is listed AND the Username
//                     matches the Name the ticket was created with (case-
//                     insensitive, leading @ ignored). The feed answers only
//                     { listed: true|false, ticket } for the CALLER's own
//                     ticket + key and never returns the list. Tab name is
//                     matched case-insensitively (ContribWS / contribWS).
//   TicketApprovalWS  ?type=ticket, ?type=ticketinfo, POST type=ticket
//                     (also read by CUST for its ticket checks, and
//                     IMPORTRANGE'd into MOD's UsernameListed from col C)
//
// Every feed except build/ticket/ticketinfo needs an approved
// &ticket=<id>&key=<key>; unknown and wrong-key tickets look the same.
// Tickets: 24-char secret key each, one per browser (ClientID), the first
// TICKET_AUTO_APPROVE are approved automatically, usernames must be unique
// and not too similar (skeleton + edit distance 1, mirrored in
// wordfilter.js). Reason = "grade|name|role|paragraph".
// Feeds are cached (CacheService, chunked); edits clear them via onEdit /
// onSheetChange (run installChangeTrigger() once) or clearCache().
// Bump WS_BUILD on every deploy; check with ?type=build.
// ═══════════════════════════════════════════════════════════════════════
const WS_BUILD = "WS-DATA-04";

// Customization feeds live in CUST now. Asking DATA for one answers "moved"
// instead of falling through to the assets feed.
const MOVED_TO_CUST = ["themes", "widgets", "banners", "gifpacks"];

const SHEET = {
  quotes:   "QuoteSystemWS",
  assets:   "AssetBuilderWS",
  devbuild: "DevBuildWS",
  sync:     "SystemDataSyncWS",
  tickets:  "TicketApprovalWS",
  ratings:  "RatingLogWS",
  contrib:  "ContribWS",
  qr:       "QRWS",
};

const FEEDS_BY_SHEET = {
  [SHEET.quotes]:   ["quotes", "searchquotes"],
  [SHEET.assets]:   ["assets", "discovery"],
  [SHEET.devbuild]: ["devbuild"],
  [SHEET.sync]:     ["sync"],
  [SHEET.tickets]:  ["tickets"],
  [SHEET.ratings]:  ["discovery"],
  [SHEET.contrib]:  ["contrib"],
  [SHEET.qr]:       ["qr"],
};

const ALL_FEEDS = ["quotes", "searchquotes", "assets", "discovery", "devbuild", "sync", "tickets", "contrib", "qr"];

const ASSET_HEADERS = [
  "title", "author", "link", "image", "category", "sub-category",
  "status", "page", "type", "animated", "description",
];
const ASSET_WIDTH = ASSET_HEADERS.length;

const CACHE_PREFIX = "ws2:";
const CACHE_TTL    = 300;
const CACHE_CHUNK  = 24000;
const LOCK_WAIT_MS = 10000;

const TICKET_APPROVED  = ["approved", "accepted"];
const TICKET_ID_LEN    = 8;
const TICKET_ID_CHARS  = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const TICKET_NAME_MAX  = 40;
const TICKET_REASON_MAX = 900;
const TICKET_REASON_RE  = /^(9|10|11|12)\|[^|]*\|(normie|tester|contributor)\|[^|]*$/;
const TICKET_HEADERS   = ["Timestamp", "TicketID", "Name", "Reason", "Status", "ClientID", "Key"];
const TICKET_KEY_LEN   = 24;
const TICKET_USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.\-]{2,19}$/;
const TICKET_SIMILAR_MIN = 6;
const TICKET_AUTO_APPROVE = 50;
const TICKET_CLIENT_MAX = 64;

let _bookRef = null;
let _cacheRef = null;

function doGet(e) {
  const p = (e && e.parameter) || {};
  const fresh = p.fresh === "1" || p.fresh === "true";

  const type = _key(p.type || "assets");
  if (type === "build")  return _json({ build: WS_BUILD });
  if (type === "ticket") return _ticketGet(p);
  if (type === "ticketinfo") return _ticketInfoGet();
  if (MOVED_TO_CUST.indexOf(type) !== -1) return _json({ error: "Moved to the CUST feed.", moved: "cust", items: [] });

  const ticket = _ticketStatus(p.ticket, p.key);
  if (!_ticketIsApproved(ticket)) {
    return _json({ error: "Ticket required.", ticket: ticket || (p.ticket ? "unknown" : "missing"), items: [] });
  }

  switch (type) {
    case "quotes":       return _quotesGet(1, "quotes", fresh);
    case "searchquotes": return _quotesGet(2, "searchquotes", fresh);
    case "qr":           return _qrGet(fresh);
    case "sync":         return _syncGet(fresh);
    case "devbuild":     return _assetFeedGet(p, _devBuildSheet(), "devbuild", fresh);
    case "discovery":    return _discoveryGet(p, fresh);
    case "asset":        return _assetAliasGet(p, fresh);
    case "contrib":      return _contribGet(p);
    case "assets":
    default:             return _assetFeedGet(p, _assetSheet(), "assets", fresh);
  }
}

function doPost(e) {
  const raw = e && e.postData && e.postData.contents;
  let body = null;
  let malformed = false;

  if (raw) {
    try { body = JSON.parse(raw); } catch (err) { malformed = true; }
  }
  if (!body || typeof body !== "object") body = raw ? {} : ((e && e.parameter) || {});

  const type = _key(body.type || (e && e.parameter && e.parameter.type) || "assets");

  switch (type) {
    case "sync":     return _syncPost(raw ? body : {}, malformed);
    case "ticket":   return _ticketPost(malformed ? null : body);
    case "rate":     return _ratePost(malformed ? null : body);
    case "devbuild": return _assetFeedPost(body, _devBuildSheet());
    case "asset":    return _assetAliasPost(body);
    case "assets":
    default:         return _assetFeedPost(body, _assetSheet());
  }
}

function onEdit(e) {
  try {
    const name = e && e.range ? e.range.getSheet().getName() : "";
    _invalidateSheet(name);
  } catch (err) {}
}

function onSheetChange() {
  _invalidateAll();
}

function installChangeTrigger() {
  const exists = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === "onSheetChange");
  if (!exists) {
    ScriptApp.newTrigger("onSheetChange").forSpreadsheet(_book()).onChange().create();
  }
  return exists ? "onSheetChange trigger already installed." : "onSheetChange trigger installed.";
}

function clearCache() {
  _invalidateAll();
  return "WannaSmile feed cache cleared.";
}

function _book() {
  return _bookRef || (_bookRef = SpreadsheetApp.getActiveSpreadsheet());
}

function _sheet(name, fallbackToFirst) {
  let byName = _book().getSheetByName(name);
  if (!byName) {
    // Tab names are matched case-insensitively (ContribWS / contribWS).
    const want = _key(name);
    byName = _book().getSheets().filter(sh => _key(sh.getName()) === want)[0] || null;
  }
  if (byName || !fallbackToFirst) return byName;
  const sheets = _book().getSheets();
  return sheets.length ? sheets[0] : null;
}

function _assetSheet()    { return _sheet(SHEET.assets, true); }
function _devBuildSheet() { return _sheet(SHEET.devbuild, false); }

function _key(v) {
  return String(v == null ? "" : v).trim().toLowerCase();
}

function _blank(cell) {
  return cell === "" || cell === null || cell === undefined || String(cell).trim() === "";
}

function _hasContent(row) {
  for (let i = 0; i < row.length; i++) if (!_blank(row[i])) return true;
  return false;
}

function _out(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

function _json(obj) {
  return _out(JSON.stringify(obj));
}

function _cache() {
  return _cacheRef || (_cacheRef = CacheService.getScriptCache());
}

function _cacheGet(feed) {
  try {
    const head = _cache().get(CACHE_PREFIX + feed);
    if (head === null) return null;
    const sep = head.indexOf("|");
    const n = Number(head.slice(0, sep));
    const stamp = head.slice(sep + 1);
    if (sep < 1 || !(n > 0) || !stamp) return null;

    const keys = [];
    for (let i = 0; i < n; i++) keys.push(CACHE_PREFIX + feed + ":" + stamp + ":" + i);
    const parts = _cache().getAll(keys);

    let text = "";
    for (let i = 0; i < n; i++) {
      const part = parts[keys[i]];
      if (part === undefined || part === null) return null;
      text += part;
    }
    return text;
  } catch (err) {
    return null;
  }
}

function _cachePut(feed, text) {
  try {
    const n = Math.max(1, Math.ceil(text.length / CACHE_CHUNK));
    const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const values = {};
    for (let i = 0; i < n; i++) {
      values[CACHE_PREFIX + feed + ":" + stamp + ":" + i] = text.substr(i * CACHE_CHUNK, CACHE_CHUNK);
    }
    _cache().putAll(values, CACHE_TTL);
    _cache().put(CACHE_PREFIX + feed, n + "|" + stamp, CACHE_TTL);
  } catch (err) {}
}

function _invalidateFeeds(feeds) {
  try { _cache().removeAll(feeds.map(f => CACHE_PREFIX + f)); } catch (err) {}
}

function _invalidateAll() {
  _invalidateFeeds(ALL_FEEDS);
}

function _invalidateSheet(name) {
  let feeds = FEEDS_BY_SHEET[name];
  if (!feeds) {
    const want = _key(name);
    const hit = Object.keys(FEEDS_BY_SHEET).filter(k => _key(k) === want)[0];
    if (hit) feeds = FEEDS_BY_SHEET[hit];
  }
  if (feeds) _invalidateFeeds(feeds);
  else _invalidateAll();
}

function _serve(feed, fresh, build, onError) {
  if (!fresh) {
    const hit = _cacheGet(feed);
    if (hit !== null) return _out(hit);
  }
  let text;
  try {
    text = JSON.stringify(build());
  } catch (err) {
    return _json(onError(err));
  }
  _cachePut(feed, text);
  return _out(text);
}

function _errMsg(err) {
  return String((err && err.message) || err);
}

function _withLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) return _json({ ok: false, error: "Busy — try again." });
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function _quotesGet(col, feed, fresh) {
  return _serve(feed, fresh, () => {
    const sheet = _sheet(SHEET.quotes, false);
    if (!sheet) throw new Error("Sheet '" + SHEET.quotes + "' not found.");

    const lastRow = sheet.getLastRow();
    if (lastRow < 1) return { "": [] };

    const column = sheet.getRange(1, col, lastRow, 1).getValues();
    const header = String(column[0][0]).trim();
    const values = [];
    for (let i = 1; i < column.length; i++) {
      const v = column[i][0];
      if (v !== "" && v !== null) values.push(String(v));
    }
    return { [header]: values };
  }, err => ({ error: _errMsg(err) }));
}

function _qrCellURL(value) {
  let cell = String(value == null ? "" : value).trim();
  if (!cell || cell.charAt(0) === "#") return "";
  if (cell.charAt(0) === "'") cell = cell.slice(1).trim();

  // Spreadsheet copy/paste sometimes stores a link as HTML or Markdown text.
  const html = cell.match(/href\s*=\s*["'](https?:\/\/[^"']+)["']/i);
  const markdown = cell.match(/\]\((https?:\/\/[^)\s]+)\)/i);
  const plain = cell.match(/https?:\/\/[^\s<>"']+/i);
  let url = (html && html[1]) || (markdown && markdown[1]) || (plain && plain[0]) || "";
  url = url.replace(/[\])},;]+$/, "");
  return url.length <= 500 && /^https?:\/\/[^\s]+$/i.test(url) ? url : "";
}

function _qrGet(fresh) {
  return _serve("qr", fresh, () => {
    const sheet = _sheet(SHEET.qr, false);
    if (!sheet) throw new Error("Sheet '" + SHEET.qr + "' not found.");

    const lastRow = sheet.getLastRow();
    if (lastRow < 1) return { "valid-qr-url": [] };

    const column = sheet.getRange(1, 1, lastRow, 1).getValues();
    const header = String(column[0][0] || "valid-qr-url").trim();
    const urls = [];
    const seen = new Set();
    for (let i = 1; i < column.length && urls.length < 12; i++) {
      const url = _qrCellURL(column[i][0]);
      if (url && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
    return { [header]: urls };
  }, err => ({ error: _errMsg(err) }));
}

function _syncNormalizeKey(k) {
  return String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function _syncGet(fresh) {
  return _serve("sync", fresh, () => {
    const sheet = _sheet(SHEET.sync, true);
    const values = sheet ? sheet.getDataRange().getValues() : [];

    const headers = values.length >= 2 ? values[0].map(h => String(h).trim()) : [];
    const rows = values.length >= 2 ? values.slice(1).filter(_hasContent) : [];

    const cols = {};
    headers.forEach((h, i) => {
      cols[h] = rows.map(r => (r[i] !== undefined ? r[i] : ""));
    });

    const stKey = headers.find(h => _syncNormalizeKey(h) === "sourcetruth");
    let canonicalOwner = "";
    if (stKey) {
      const col = cols[stKey];
      for (let i = col.length - 1; i >= 0; i--) {
        const v = String(col[i]).trim();
        if (v) { canonicalOwner = v; break; }
      }
    }

    return Object.assign({}, cols, { canonicalOwner, error: null });
  }, err => ({ canonicalOwner: "", error: _errMsg(err) }));
}

function _syncPost(body, malformed) {
  try {
    if (malformed) return _json({ ok: false, error: "Malformed JSON body." });

    const secret = PropertiesService.getScriptProperties().getProperty("SECRET_TOKEN");
    if (!secret || body.token !== secret) return _json({ ok: false, error: "Unauthorized." });

    const owner = body.sourceTruth;
    if (!owner || typeof owner !== "string" || !owner.trim()) {
      return _json({ ok: false, error: "Missing 'sourceTruth' string." });
    }

    return _withLock(() => {
      const sheet = _sheet(SHEET.sync, true);
      if (!sheet) return _json({ ok: false, error: "No sheet found." });

      const values = sheet.getDataRange().getValues();
      if (values.length < 2) return _json({ ok: false, error: "No data rows found." });

      const colIndex = values[0].findIndex(h => _syncNormalizeKey(String(h).trim()) === "sourcetruth");
      if (colIndex === -1) return _json({ ok: false, error: "No SourceTruth column found." });

      let lastRow = -1;
      for (let r = values.length - 1; r >= 1; r--) {
        if (_hasContent(values[r])) { lastRow = r; break; }
      }
      if (lastRow === -1) return _json({ ok: false, error: "No data rows to update." });

      const newOwner = owner.trim();
      sheet.getRange(lastRow + 1, colIndex + 1).setValue(newOwner);
      _invalidateSheet(sheet.getName());
      return _json({ ok: true, canonicalOwner: newOwner });
    });
  } catch (err) {
    return _json({ ok: false, error: _errMsg(err) });
  }
}

function _assetRowToObject(row) {
  const item = {};
  for (let i = 0; i < ASSET_WIDTH; i++) {
    item[ASSET_HEADERS[i]] = row[i] !== undefined ? row[i] : "";
  }
  return item;
}

function _assetObjectToRow(obj) {
  return ASSET_HEADERS.map(h => (obj && obj[h] !== undefined ? obj[h] : ""));
}

function _assetReadRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, ASSET_WIDTH).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (_hasContent(values[i])) out.push(_assetRowToObject(values[i]));
  }
  return out;
}

function _assetFindRowByTitle(sheet, title) {
  const needle = _key(title);
  if (!needle) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (_key(values[i][0]) === needle) return i + 2;
  }
  return -1;
}

function _assetLastDataRow(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 1;
  const values = sheet.getRange(2, 1, lastRow - 1, ASSET_WIDTH).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (_hasContent(values[i])) return i + 2;
  }
  return 1;
}

function _assetEnsureHeaders(sheet) {
  const header = sheet.getRange(1, 1, 1, ASSET_WIDTH).getValues()[0];
  if (!_hasContent(header)) sheet.getRange(1, 1, 1, ASSET_WIDTH).setValues([ASSET_HEADERS]);
}

function _assetTokenOk(body) {
  const secret = PropertiesService.getScriptProperties().getProperty("SECRET_TOKEN");
  return !secret || (body && body.token === secret);
}

function _assetFeedGet(params, sheet, feed, fresh) {
  if (!sheet) return _json({ error: "No sheet found.", items: [] });
  const action = _key(params.action || "all");

  try {

    if (action === "meta") {
      return _json({ sheetName: sheet.getName(), headers: ASSET_HEADERS, count: _assetReadRows(sheet).length });
    }

    if (action === "row") {
      const n = Number(params.row || params.rowNumber || 0);
      const target = Number.isFinite(n) && n >= 2 ? n : -1;
      if (target === -1 || target > sheet.getLastRow()) {
        return _json({ error: "Missing or invalid row.", item: null });
      }
      const row = sheet.getRange(target, 1, 1, ASSET_WIDTH).getValues()[0];
      return _json({ item: _assetRowToObject(row), row: target });
    }

    if (action === "find") {
      const row = _assetFindRowByTitle(sheet, params.title || params.q || "");
      if (row === -1) return _json({ error: "Not found.", row: -1, item: null });
      const values = sheet.getRange(row, 1, 1, ASSET_WIDTH).getValues()[0];
      return _json({ item: _assetRowToObject(values), row });
    }

    return _serve(feed, fresh, () => _assetReadRows(sheet),
      err => ({ error: _errMsg(err), items: [] }));
  } catch (err) {
    return _json({ error: _errMsg(err), items: [] });
  }
}

function _assetFeedPost(body, sheet) {
  try {
    if (!_assetTokenOk(body)) return _json({ ok: false, error: "Unauthorized." });
    if (!sheet) return _json({ ok: false, error: "No sheet found." });

    const action = _key(body.action || body.op || "upsert");

    if (action === "list") {
      return _json({ ok: true, items: _assetReadRows(sheet) });
    }

    return _withLock(() => {
      _assetEnsureHeaders(sheet);
      const result = _assetWrite(action, body, sheet);
      if (result.ok) _invalidateSheet(sheet.getName());
      return _json(result);
    });
  } catch (err) {
    return _json({ ok: false, error: _errMsg(err) });
  }
}

function _assetAppend(sheet, row) {
  const nextRow = Math.max(_assetLastDataRow(sheet) + 1, 2);
  sheet.getRange(nextRow, 1, 1, ASSET_WIDTH).setValues([row]);
  return nextRow;
}

function _assetWrite(action, body, sheet) {
  const payload = body.item || body.row || body;

  if (action === "add" || action === "append") {
    const row = _assetObjectToRow(payload);
    const nextRow = _assetAppend(sheet, row);
    return { ok: true, row: nextRow, item: _assetRowToObject(row) };
  }

  if (action === "update" || action === "upsert") {
    let targetRow = Number(body.row || body.rowNumber || 0);
    if (!Number.isFinite(targetRow) || targetRow < 2) {
      targetRow = _assetFindRowByTitle(sheet, body.title || (body.item && body.item.title) || "");
    }
    if (!Number.isFinite(targetRow) || targetRow < 2) {
      const row = _assetObjectToRow(payload);
      const nextRow = _assetAppend(sheet, row);
      return { ok: true, created: true, row: nextRow, item: _assetRowToObject(row) };
    }

    const range = sheet.getRange(targetRow, 1, 1, ASSET_WIDTH);
    const merged = Object.assign(_assetRowToObject(range.getValues()[0]), payload);
    const row = _assetObjectToRow(merged);
    range.setValues([row]);
    return { ok: true, updated: true, row: targetRow, item: _assetRowToObject(row) };
  }

  if (action === "delete") {
    const targetRow = Number(body.row || body.rowNumber || 0);
    if (!Number.isFinite(targetRow) || targetRow < 2) return { ok: false, error: "Missing or invalid row." };
    const removed = sheet.getRange(targetRow, 1, 1, ASSET_WIDTH).getValues()[0];
    sheet.deleteRow(targetRow);
    return { ok: true, deleted: true, row: targetRow, item: _assetRowToObject(removed) };
  }

  if (action === "move") {
    const fromRow = Number(body.fromRow || body.row || body.rowNumber || 0);
    const toRow = Number(body.toRow || body.targetRow || 0);
    if (!Number.isFinite(fromRow) || fromRow < 2 || !Number.isFinite(toRow) || toRow < 2) {
      return { ok: false, error: "Missing or invalid fromRow/toRow." };
    }
    if (fromRow > sheet.getLastRow()) return { ok: false, error: "fromRow is out of range." };

    // Through column L, so the asset's ratings move with it.
    const values = sheet.getRange(fromRow, 1, 1, RATING_COL).getValues()[0];
    sheet.deleteRow(fromRow);
    const cap = sheet.getLastRow() + 1;
    const adjustedToRow = fromRow < toRow ? Math.min(toRow - 1, cap) : Math.min(toRow, cap);
    sheet.insertRowBefore(adjustedToRow);
    sheet.getRange(adjustedToRow, 1, 1, RATING_COL).setValues([values]);
    return { ok: true, moved: true, fromRow, toRow: adjustedToRow, item: _assetRowToObject(values) };
  }

  if (action === "reorder") {
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return { ok: false, error: "Missing items array." };

    const existing = _assetReadRows(sheet);
    const byTitle = new Map(existing.map(item => [_key(item.title), item]));

    const ordered = [];
    for (const entry of items) {
      if (typeof entry === "string") {
        const hit = byTitle.get(_key(entry));
        if (hit) ordered.push(hit);
      } else if (entry && typeof entry === "object") {
        const k = _key(entry.title);
        ordered.push(entry.title && byTitle.has(k) ? byTitle.get(k) : entry);
      }
    }

    const used = new Set(ordered.map(item => _key(item.title)));
    const next = ordered.concat(existing.filter(item => !used.has(_key(item.title))));

    // Column L (ratings) isn't part of the A–K objects: carry it by title so
    // each asset keeps its own ratings after the rewrite.
    const lastRow = sheet.getLastRow();
    const ratingByTitle = new Map();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, RATING_COL).getValues().forEach(r => {
        if (!_blank(r[RATING_COL - 1])) ratingByTitle.set(_key(r[0]), r[RATING_COL - 1]);
      });
      sheet.getRange(2, 1, lastRow - 1, ASSET_WIDTH).clearContent();
      sheet.getRange(2, RATING_COL, lastRow - 1, 1).clearContent();
    }
    if (next.length) {
      sheet.getRange(2, 1, next.length, ASSET_WIDTH).setValues(next.map(_assetObjectToRow));
      sheet.getRange(2, RATING_COL, next.length, 1).setValues(next.map(item => [ratingByTitle.get(_key(item.title)) || ""]));
    }
    return { ok: true, reordered: true, count: next.length };
  }

  return { ok: false, error: "Unknown action: " + action };
}

function _assetAliasSheet(source) {
  return _key(source && source.sheet) === "devbuild" ? _devBuildSheet() : _assetSheet();
}

function _assetAliasGet(params, fresh) {
  const action = params.row ? "row" : (params.title ? "find" : "all");
  const isDev = _key(params.sheet) === "devbuild";
  return _assetFeedGet(
    Object.assign({}, params, { action }),
    _assetAliasSheet(params),
    isDev ? "devbuild" : "assets",
    fresh
  );
}

function _assetAliasPost(body) {
  const aliasBody = Object.assign({}, body, { action: "update", item: body.item || body.data || {} });
  return _assetFeedPost(aliasBody, _assetAliasSheet(body));
}

// ── Ratings (the Discovery page) ─────────────────────────────────────
// Column L of AssetBuilderWS ("rating") holds every rating an asset has
// had, e.g. rating:[1.3,2.0,4.5,5.0]; Discovery shows their average (3.2)
// and nothing else on the site reads them. Each rating is added to the
// list, never replaced. RatingLogWS remembers who rated what, so a ticket
// rates each asset once. =RATINGAVG(L2) shows the average in the sheet.
const RATING_COL = 12;   // L
const RATING_MIN = 1;
const RATING_MAX = 5;
const RATING_LOG_HEADERS = ["Timestamp", "TicketID", "Link", "Title", "Rating"];

function _ratingParse(cell) {
  const m = String(cell == null ? "" : cell).match(/\[([^\]]*)\]/);
  if (!m) return [];
  return m[1].split(",")
    .map(s => Number(String(s).trim()))
    .filter(n => isFinite(n) && n >= RATING_MIN && n <= RATING_MAX);
}

function _ratingFormat(list) {
  return "rating:[" + list.map(n => n.toFixed(1)).join(",") + "]";
}

function _ratingAverage(list) {
  if (!list.length) return null;
  const sum = list.reduce((a, b) => a + b, 0);
  return Math.round((sum / list.length) * 10) / 10;
}

/**
 * Average of a rating cell (or a column of them), to one decimal place.
 * =RATINGAVG(L2) on rating:[1.3,2.0,4.5,5.0] gives 3.2.
 * @param {string} cell A rating:[…] cell or range.
 * @return The average rating, or blank if there are none.
 * @customfunction
 */
function RATINGAVG(cell) {
  if (Array.isArray(cell)) return cell.map(r => [RATINGAVG(Array.isArray(r) ? r[0] : r)]);
  const avg = _ratingAverage(_ratingParse(cell));
  return avg === null ? "" : avg;
}

function _ratingSheet() {
  let sheet = _sheet(SHEET.ratings, false);
  if (!sheet) {
    sheet = _book().insertSheet(SHEET.ratings);
    sheet.appendRow(RATING_LOG_HEADERS);
  }
  return sheet;
}

// { link: rating } for everything this ticket has rated.
function _ratedBy(ticket) {
  const tid = String(ticket == null ? "" : ticket).trim();
  const out = {};
  const sheet = _sheet(SHEET.ratings, false);
  if (!tid || !sheet || sheet.getLastRow() < 2) return out;
  sheet.getRange(2, 2, sheet.getLastRow() - 1, 4).getValues().forEach(r => {
    if (String(r[0]).trim() === tid) out[String(r[1]).trim()] = Number(r[3]);
  });
  return out;
}

function _assetFindRowByLink(sheet, link) {
  const needle = String(link == null ? "" : link).trim();
  if (!needle || sheet.getLastRow() < 2) return -1;
  const values = sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === needle) return i + 2;
  }
  return -1;
}

// Asset rows (A–K) plus rating (average, one decimal, or null) and
// ratings (how many).
function _discoveryItems(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, RATING_COL).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (!_hasContent(values[i].slice(0, ASSET_WIDTH))) continue;
    const item = _assetRowToObject(values[i]);
    const list = _ratingParse(values[i][RATING_COL - 1]);
    item.rating  = _ratingAverage(list);
    item.ratings = list.length;
    out.push(item);
  }
  return out;
}

// { items: [...], mine: { link: rating } }. The items are cached for
// everyone; "mine" is this ticket's own ratings, read fresh each time.
function _discoveryGet(params, fresh) {
  const sheet = _assetSheet();
  if (!sheet) return _json({ error: "No sheet found.", items: [], mine: {} });
  try {
    let items = fresh ? null : _cacheGet("discovery");
    if (items === null) {
      items = JSON.stringify(_discoveryItems(sheet));
      _cachePut("discovery", items);
    }
    return _out('{"items":' + items + ',"mine":' + JSON.stringify(_ratedBy(params.ticket)) + "}");
  } catch (err) {
    return _json({ error: _errMsg(err), items: [], mine: {} });
  }
}

// POST { type: "rate", ticket, key, link, rating }: adds one rating (1–5,
// one decimal) to the asset whose link matches. Once per ticket per asset.
function _ratePost(body) {
  if (!body || typeof body !== "object") return _json({ ok: false, code: "bad_request", error: "Bad request." });
  const ticket = String(body.ticket || "").trim();
  if (!_ticketIsApproved(_ticketStatus(ticket, body.key))) {
    return _json({ ok: false, code: "ticket", error: "An approved access ticket is needed to rate." });
  }
  const value = Math.round(Number(body.rating) * 10) / 10;
  if (!isFinite(value) || value < RATING_MIN || value > RATING_MAX) {
    return _json({ ok: false, code: "bad_rating", error: "Ratings go from 1 to 5." });
  }
  const link = String(body.link || "").trim();
  if (!link) return _json({ ok: false, code: "bad_asset", error: "Which asset?" });

  return _withLock(() => {
    const log = _ratingSheet();
    if (_ratedBy(ticket)[link] !== undefined) {
      return _json({ ok: false, code: "already_rated", error: "You've already rated this one." });
    }
    const sheet = _assetSheet();
    const row = sheet ? _assetFindRowByLink(sheet, link) : -1;
    if (row === -1) return _json({ ok: false, code: "bad_asset", error: "That asset isn't in the library." });

    const cell = sheet.getRange(row, RATING_COL);
    const list = _ratingParse(cell.getValue());
    list.push(value);
    cell.setValue(_ratingFormat(list));
    log.appendRow([new Date(), ticket, link, sheet.getRange(row, 1).getValue(), value]);
    _invalidateFeeds(["discovery"]);
    return _json({ ok: true, rating: _ratingAverage(list), ratings: list.length, mine: value });
  });
}

function _ticketSheet() {
  return _sheet(SHEET.tickets, false);
}

function _ticketColumns(header) {
  const find = (name, fallback) => {
    const i = header.findIndex(h => _key(h) === _key(name));
    return i === -1 ? fallback : i;
  };
  return { id: find("TicketID", 1), status: find("Status", 4), key: find("Key", -1) };
}

function _ticketMap() {
  const hit = _cacheGet("tickets");
  if (hit !== null) {
    try { return JSON.parse(hit); } catch (err) {}
  }
  const sheet = _ticketSheet();
  const map = {};
  if (sheet && sheet.getLastRow() >= 2) {
    const values = sheet.getDataRange().getValues();
    const col = _ticketColumns(values[0]);
    for (let r = 1; r < values.length; r++) {
      const id = String(values[r][col.id] == null ? "" : values[r][col.id]).trim();
      if (!id) continue;
      const k = col.key === -1 ? "" : String(values[r][col.key] == null ? "" : values[r][col.key]).trim();
      map[id] = { s: _key(values[r][col.status]) || "pending", k: k };
    }
  }
  _cachePut("tickets", JSON.stringify(map));
  return map;
}

function _ticketStatus(id, key) {
  const tid = String(id == null ? "" : id).trim();
  if (!tid) return "";
  let entry = _ticketMap()[tid];
  if (!entry) return "";
  if (typeof entry === "string") entry = { s: entry, k: "" };
  if (entry.k && entry.k !== String(key == null ? "" : key).trim()) return "";
  return entry.s;
}

function _ticketIsApproved(status) {
  return TICKET_APPROVED.indexOf(status) !== -1;
}

function _ticketGet(params) {
  const id = String(params.id || params.ticket || "").trim();
  if (!id) return _json({ error: "Missing ticket id.", ticket: "", status: "missing" });
  const status = _ticketStatus(id, params.key);
  return _json({
    ticket: id,
    status: _ticketIsApproved(status) ? "approved" : (status || "unknown"),
  });
}

function _ticketCell(v, max) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function _ticketNewId(taken) {
  for (;;) {
    let id = "";
    for (let i = 0; i < TICKET_ID_LEN; i++) {
      id += TICKET_ID_CHARS.charAt(Math.floor(Math.random() * TICKET_ID_CHARS.length));
    }
    if (!taken[id]) return id;
  }
}

function _ticketNewKey() {
  let key = "";
  for (let i = 0; i < TICKET_KEY_LEN; i++) {
    key += TICKET_ID_CHARS.charAt(Math.floor(Math.random() * TICKET_ID_CHARS.length));
  }
  return key;
}

function _ticketPlain(v) {
  return String(v == null ? "" : v).replace(/^'/, "").trim();
}

function _ticketSkeleton(v) {
  const map = { "0": "o", "1": "i", "l": "i", "|": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "8": "b", "9": "g" };
  let out = "";
  const s = _ticketPlain(v).toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const ch = map[s.charAt(i)] || s.charAt(i);
    if (ch < "a" || ch > "z") continue;
    if (out.charAt(out.length - 1) !== ch) out += ch;
  }
  return out;
}

function _ticketSimilar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < TICKET_SIMILAR_MIN || Math.abs(a.length - b.length) > 1) return false;
  let prev = [];
  for (let j = 0; j <= b.length; j++) prev.push(j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > 1) return false;
    prev = cur;
  }
  return prev[b.length] <= 1;
}

function _ticketPost(body) {
  try {
    if (!body) return _json({ ok: false, error: "Malformed JSON body." });
    const rawName = String(body.name == null ? "" : body.name).trim();
    if (!TICKET_USERNAME_RE.test(rawName)) {
      return _json({ ok: false, code: "bad_name", error: "Usernames are 3-20 letters, numbers, _ . or -, starting with a letter or number." });
    }
    const name = _ticketCell(rawName, TICKET_NAME_MAX);
    const reason = _ticketCell(body.reason, TICKET_REASON_MAX);
    const client = String(body.client == null ? "" : body.client).trim().slice(0, TICKET_CLIENT_MAX);
    if (!name)   return _json({ ok: false, error: "Missing name." });
    if (!reason) return _json({ ok: false, error: "Missing reason." });
    if (!TICKET_REASON_RE.test(reason)) return _json({ ok: false, code: "bad_reason", error: "Reason must be grade|name|role|paragraph." });
    if (!/^[A-Za-z0-9-]{16,}$/.test(client)) return _json({ ok: false, error: "Missing client id." });

    return _withLock(() => {
      const sheet = _ticketSheet();
      if (!sheet) return _json({ ok: false, error: "Sheet '" + SHEET.tickets + "' not found." });
      if (sheet.getLastRow() < 1) sheet.getRange(1, 1, 1, TICKET_HEADERS.length).setValues([TICKET_HEADERS]);

      let width = Math.max(sheet.getLastColumn(), 1);
      let header = sheet.getRange(1, 1, 1, width).getValues()[0];
      TICKET_HEADERS.forEach(h => {
        if (header.some(x => _key(x) === _key(h))) return;
        width++;
        sheet.getRange(1, width).setValue(h);
        header = header.concat([h]);
      });
      const col = name => header.findIndex(h => _key(h) === _key(name));
      const c = { id: col("TicketID"), name: col("Name"), status: col("Status"), client: col("ClientID"), key: col("Key") };

      const rows = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues() : [];
      const taken = {};
      let count = 0;
      const wanted = _ticketSkeleton(rawName);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const id = String(r[c.id] == null ? "" : r[c.id]).trim();
        if (!id) continue;
        taken[id] = true;
        count++;
        if (String(r[c.client] == null ? "" : r[c.client]).trim() === client) {
          let key = String(r[c.key] == null ? "" : r[c.key]).trim();
          if (!key) {
            key = _ticketNewKey();
            sheet.getRange(i + 2, c.key + 1).setValue(key);
            _invalidateFeeds(["tickets"]);
          }
          const status = _key(r[c.status]);
          return _json({ ok: true, existing: true, ticket: id, key: key, name: _ticketPlain(r[c.name]), status: _ticketIsApproved(status) ? "approved" : (status || "pending") });
        }
      }
      for (const r of rows) {
        if (String(r[c.id] == null ? "" : r[c.id]).trim() && _ticketSimilar(_ticketSkeleton(r[c.name]), wanted)) {
          return _json({ ok: false, code: "name_taken", error: "That username, or one too close to it, is taken." });
        }
      }

      const id = _ticketNewId(taken);
      const key = _ticketNewKey();
      const status = count < TICKET_AUTO_APPROVE ? "approved" : "pending";
      const row = header.map(() => "");
      row[col("Timestamp")] = new Date();
      row[c.id] = id;
      row[c.name] = name;
      row[col("Reason")] = reason;
      row[c.status] = status;
      row[c.client] = client;
      row[c.key] = key;
      sheet.appendRow(row);
      _invalidateFeeds(["tickets"]);
      return _json({ ok: true, ticket: id, key: key, name: rawName, status });
    });
  } catch (err) {
    return _json({ ok: false, error: _errMsg(err) });
  }
}

// ── Contributors (debug panel access) ────────────────────────────────────
// ContribWS replaces the old tools/list.json. The site asks ?type=contrib
// with its own ticket + key (the approved-ticket gate in doGet has already
// run); we answer only whether THAT ticket is listed. The username is
// compared with the Name stored for the ticket in TicketApprovalWS, not with
// anything the browser sends, so a copied ticket id alone is worthless.
function _contribUser(v) {
  return String(v == null ? "" : v).trim().replace(/^'/, "").replace(/^@/, "").toLowerCase();
}

// { "<TicketID>": ["username", ...] } from ContribWS, cached like other feeds.
function _contribMap() {
  const hit = _cacheGet("contrib");
  if (hit !== null) {
    try { return JSON.parse(hit); } catch (err) {}
  }
  const map = {};
  const sheet = _sheet(SHEET.contrib, false);
  if (sheet && sheet.getLastRow() >= 2) {
    const values = sheet.getDataRange().getValues();
    const find = (name, fallback) => {
      const i = values[0].findIndex(h => _key(h) === _key(name));
      return i === -1 ? fallback : i;
    };
    const col = { id: find("TicketID", 0), user: find("Username", 1) };
    for (let r = 1; r < values.length; r++) {
      const id = String(values[r][col.id] == null ? "" : values[r][col.id]).trim().replace(/^'/, "");
      const user = _contribUser(values[r][col.user]);
      if (!id || id.charAt(0) === "#" || !user) continue;
      (map[id] = map[id] || []).push(user);
    }
  }
  _cachePut("contrib", JSON.stringify(map));
  return map;
}

// The Name a ticket was created with (TicketApprovalWS), normalized; "" if none.
function _ticketNameOf(id) {
  const sheet = _ticketSheet();
  if (!sheet || sheet.getLastRow() < 2) return "";
  const values = sheet.getDataRange().getValues();
  const find = (name, fallback) => {
    const i = values[0].findIndex(h => _key(h) === _key(name));
    return i === -1 ? fallback : i;
  };
  const col = { id: find("TicketID", 1), name: find("Name", 2) };
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][col.id] == null ? "" : values[r][col.id]).trim() === id) return _contribUser(values[r][col.name]);
  }
  return "";
}

function _contribGet(params) {
  const id = String(params.ticket || params.id || "").trim();
  try {
    const names = _contribMap()[id];
    const who = names && names.length ? _ticketNameOf(id) : "";
    return _json({ listed: !!who && names.indexOf(who) !== -1, ticket: id });
  } catch (err) {
    return _json({ error: _errMsg(err), listed: false, ticket: id });
  }
}

function _ticketInfoGet() {
  const count = Object.keys(_ticketMap()).length;
  return _json({
    autoApprove: count < TICKET_AUTO_APPROVE,
    autoApproveLeft: Math.max(0, TICKET_AUTO_APPROVE - count),
  });
}