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
//   ChatFriendsWS     WannaChat friend requests / friendships (made on first use)
//   ChatMessagesWS    WannaChat messages, newest 60 kept per friendship
//                     ?type=chat (GET) and POST type=chat, see "WannaChat"
//                     below; chatCleanup() is the daily tidy-up.
//   ProfileNetWS      profile, connections and avatars (see "ProfileNet" below);
//                     ?type=profile (GET) and POST type=profile
//
//   The optional DM websocket worker (documentation/websocket/) uses two more:
//                     ?type=whoami: caller's own approved ticket + key -> its
//                     username { ok, name } (the DM login).
//                     POST type=userexists + SECRET_TOKEN: { ok, exists } for an
//                     approved username (server-to-server, for the friend list).
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
const WS_BUILD = "WS-DATA-07";

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
  chatFriends:  "ChatFriendsWS",
  chatMessages: "ChatMessagesWS",
  profiles:     "ProfileNetWS",
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
  // Chat sheets are written by the script and never feed a cached feed.
  [SHEET.chatFriends]:  [],
  [SHEET.chatMessages]: [],
  [SHEET.profiles]:     [],
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
    case "whoami":       return _whoamiGet(p);
    case "chat":         return _chatGet(p);
    case "profile":      return _profileGet(p);
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
    case "userexists": return _userExistsPost(malformed ? null : body);
    case "chat":     return _chatPost(malformed ? null : body);
    case "profile":  return _profilePost(malformed ? null : body);
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

// ── DM backend helpers ───────────────────────────────────────────────────
// ?type=whoami&ticket=…&key=…  The approved-ticket gate in doGet has already
// required a matching key, so only the holder of the key gets the name back.
function _whoamiGet(params) {
  const id = String(params.ticket || "").trim();
  const name = _ticketNameOf(id);
  return _json({ ok: !!name, ticket: id, name: name });
}

// POST { type: "userexists", token: SECRET_TOKEN, name }. Answers only whether
// an APPROVED ticket exists with that Name. Needs SECRET_TOKEN to be set.
function _userExistsPost(body) {
  const secret = PropertiesService.getScriptProperties().getProperty("SECRET_TOKEN");
  if (!secret || !body || body.token !== secret) return _json({ ok: false, error: "Unauthorized." });
  const want = _contribUser(body.name);
  const sheet = _ticketSheet();
  if (!want || !sheet || sheet.getLastRow() < 2) return _json({ ok: true, exists: false });
  const values = sheet.getDataRange().getValues();
  const find = (n, fallback) => {
    const i = values[0].findIndex(h => _key(h) === _key(n));
    return i === -1 ? fallback : i;
  };
  const col = { name: find("Name", 2), status: find("Status", 4) };
  for (let r = 1; r < values.length; r++) {
    if (_contribUser(values[r][col.name]) === want && _ticketIsApproved(_key(values[r][col.status]))) {
      return _json({ ok: true, exists: true, name: want });
    }
  }
  return _json({ ok: true, exists: false });
}

function _ticketInfoGet() {

  const count = Object.keys(_ticketMap()).length;
  return _json({
    autoApprove: count < TICKET_AUTO_APPROVE,
    autoApproveLeft: Math.max(0, TICKET_AUTO_APPROVE - count),
  });
}

// ── WannaChat: friends + direct messages ─────────────────────────────────
// Lives in this project (merged in from the old WANNACHAT data.gs) so the
// site's chat page needs nothing but this URL: no websocket, no .ws file,
// no separate worker. The page polls ?type=chat and posts { type: "chat" }.
//
// Sheets (made on first use, plain-text cells so a message can never turn
// into a formula):
//   ChatFriendsWS    Pair | From | To | Status | Updated
//                      Pair   both usernames, sorted, joined by "|"
//                      Status pending (From asked To) | accepted
//   ChatMessagesWS   Pair | From | Text | Timestamp(ms)
//
// WHO YOU ARE comes from the caller's own approved ticket + key: the
// username is the ticket's Name, never something the browser claims. A
// ticket from before keys existed (blank Key) can read the site but can't
// chat, because its id alone is shareable.
//
// GET  ?type=chat&ticket&key[&with=<friend>][&rev=<last rev>]
//        -> { ok, me, rev, friends:[{ name, status: friend|incoming|outgoing,
//             last }], with, messages:[{ from, text, ts }], max }
//        rev is a cheap change marker: send it back and an idle poll answers
//        { ok, unchanged:true } from the cache without reading any sheet.
// POST { type:"chat", action, ticket, key, ... }
//        request {to} · accept {from} · decline {from} · cancel {to}
//        remove {name} · send {to, text}
//
// 60 messages are kept per friendship: each new message pushes the oldest
// one out. chatCleanup() (daily, see installChatCleanupTrigger) is the
// merge/clean-up pass: re-trims every chat, drops chats whose friendship is
// gone, drops requests nobody answered in 30 days and anything belonging to a
// ticket that is no longer approved.
const CHAT_MAX_PER_PAIR = 60;
const CHAT_MAX_TEXT     = 500;
const CHAT_MAX_FRIENDS  = 100;
const CHAT_MAX_OUTGOING = 20;
const CHAT_PENDING_DAYS = 30;
const CHAT_REV_TTL      = 21600;
const CHAT_RATE_MAX     = 8;      // messages per CHAT_RATE_SECS, per user
const CHAT_RATE_SECS    = 10;
const CHAT_NAME_RE      = /^[a-z0-9][a-z0-9_.\-]{2,19}$/;
const CHAT_FRIEND_HEADERS = ["Pair", "From", "To", "Status", "Updated"];
const CHAT_MSG_HEADERS    = ["Pair", "From", "Text", "Timestamp"];

function _chatErr(code, error) {
  return _json({ ok: false, code: code, error: error });
}

// The caller's username, or null. Needs an approved ticket WITH a key.
function _chatAuth(ticket, key) {
  const id = String(ticket == null ? "" : ticket).trim();
  const k = String(key == null ? "" : key).trim();
  if (!id || !k) return null;
  const entry = _ticketMap()[id];
  if (!entry || typeof entry === "string" || !entry.k || entry.k !== k) return null;
  if (!_ticketIsApproved(entry.s)) return null;
  const name = _chatNameOf(id);
  return CHAT_NAME_RE.test(name) ? name : null;
}

// A ticket's name never changes, so it is cached (the sheet scan is the slow part).
function _chatNameOf(id) {
  const ck = "chatname:" + id;
  try {
    const hit = _cache().get(ck);
    if (hit) return hit;
  } catch (err) {}
  const name = _ticketNameOf(id);
  if (name) { try { _cache().put(ck, name, CHAT_REV_TTL); } catch (err) {} }
  return name;
}

// { username: true } for every approved ticket.
function _chatApprovedNames() {
  const out = {};
  const sheet = _ticketSheet();
  if (!sheet || sheet.getLastRow() < 2) return out;
  const values = sheet.getDataRange().getValues();
  const find = (n, fallback) => {
    const i = values[0].findIndex(h => _key(h) === _key(n));
    return i === -1 ? fallback : i;
  };
  const col = { name: find("Name", 2), status: find("Status", 4) };
  for (let r = 1; r < values.length; r++) {
    if (_ticketIsApproved(_key(values[r][col.status]))) out[_contribUser(values[r][col.name])] = true;
  }
  return out;
}

// ── change markers (so idle polls cost almost nothing) ───────────────────
function _chatNewRev() {
  return Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

function _chatRev(name) {
  let v = null;
  try { v = _cache().get("chatrev:" + name); } catch (err) {}
  if (!v) {
    v = _chatNewRev();
    try { _cache().put("chatrev:" + name, v, CHAT_REV_TTL); } catch (err) {}
  }
  return v;
}

function _chatBump(names) {
  names.forEach(n => {
    try { _cache().put("chatrev:" + n, _chatNewRev(), CHAT_REV_TTL); } catch (err) {}
  });
}

// ── sheets ───────────────────────────────────────────────────────────────
function _chatSheet(name, headers) {
  let sheet = _sheet(name, false);
  if (!sheet) {
    sheet = _book().insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    // Text/names/pairs stay text: "=1+1" or "00123" is stored as typed.
    sheet.getRange(1, 1, sheet.getMaxRows(), 3).setNumberFormat("@");
  }
  return sheet;
}
function _chatFriendsSheet()  { return _chatSheet(SHEET.chatFriends,  CHAT_FRIEND_HEADERS); }
function _chatMessagesSheet() { return _chatSheet(SHEET.chatMessages, CHAT_MSG_HEADERS); }

function _chatPair(a, b) {
  return a < b ? a + "|" + b : b + "|" + a;
}

function _chatFriendRows() {
  const sheet = _chatFriendsSheet();
  const n = sheet.getLastRow() - 1;
  if (n < 1) return [];
  return sheet.getRange(2, 1, n, 5).getValues().map((r, i) => ({
    row: i + 2, pair: String(r[0]), from: String(r[1]), to: String(r[2]),
    status: _key(r[3]), updated: r[4],
  }));
}

function _chatMessageRows() {
  const sheet = _chatMessagesSheet();
  const n = sheet.getLastRow() - 1;
  if (n < 1) return [];
  return sheet.getRange(2, 1, n, 4).getValues().map(r => ({
    pair: String(r[0]), from: String(r[1]), text: String(r[2]), ts: Number(r[3]) || 0,
  }));
}

function _chatClean(text) {
  return String(text == null ? "" : text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, CHAT_MAX_TEXT);
}

// Newest CHAT_MAX_PER_PAIR rows of one chat stay; the earliest are deleted.
function _chatTrimPair(sheet, pair) {
  const n = sheet.getLastRow() - 1;
  if (n < 1) return;
  const pairs = sheet.getRange(2, 1, n, 1).getValues();
  const rows = [];
  for (let i = 0; i < pairs.length; i++) if (String(pairs[i][0]) === pair) rows.push(i + 2);
  const extra = rows.length - CHAT_MAX_PER_PAIR;
  if (extra <= 0) return;
  const doomed = rows.slice(0, extra);          // sheet order is time order
  for (let i = doomed.length - 1; i >= 0; i--) sheet.deleteRow(doomed[i]);
}

// ── GET ──────────────────────────────────────────────────────────────────
function _chatGet(params) {
  const me = _chatAuth(params.ticket, params.key);
  if (!me) return _chatErr("ticket", "Chat needs your own approved ticket.");

  const rev = _chatRev(me);
  if (params.rev && String(params.rev) === rev) return _json({ ok: true, unchanged: true, rev: rev, me: me });

  const withName = _contribUser(params.with);
  const mine = _chatFriendRows().filter(r => r.from === me || r.to === me);
  const friends = [];
  mine.forEach(r => {
    const other = r.from === me ? r.to : r.from;
    if (r.status === "accepted") friends.push({ name: other, status: "friend", pair: r.pair });
    else if (r.status === "pending") friends.push({ name: other, status: r.from === me ? "outgoing" : "incoming", pair: r.pair });
  });

  let messages = [];
  const accepted = {};
  friends.forEach(f => { if (f.status === "friend") accepted[f.pair] = f; });
  if (Object.keys(accepted).length) {
    const wantPair = withName ? _chatPair(me, withName) : "";
    _chatMessageRows().forEach(m => {
      const f = accepted[m.pair];
      if (!f) return;
      f.last = { from: m.from, text: m.text.slice(0, 80), ts: m.ts };   // rows are in time order
      if (m.pair === wantPair) messages.push({ from: m.from, text: m.text, ts: m.ts });
    });
    if (messages.length > CHAT_MAX_PER_PAIR) messages = messages.slice(-CHAT_MAX_PER_PAIR);
  }

  const order = { incoming: 0, friend: 1, outgoing: 2 };
  friends.sort((a, b) => (order[a.status] - order[b.status]) || ((b.last ? b.last.ts : 0) - (a.last ? a.last.ts : 0)) || (a.name < b.name ? -1 : 1));
  friends.forEach(f => { delete f.pair; if (!f.last) f.last = null; });

  return _json({ ok: true, me: me, rev: rev, friends: friends, with: withName, messages: messages, max: CHAT_MAX_PER_PAIR });
}

// ── POST ─────────────────────────────────────────────────────────────────
function _chatPost(body) {
  if (!body || typeof body !== "object") return _chatErr("bad_request", "Bad request.");
  const me = _chatAuth(body.ticket, body.key);
  if (!me) return _chatErr("ticket", "Chat needs your own approved ticket.");
  const action = _key(body.action);

  return _withLock(() => {
    const done = (extra) => {
      const out = { ok: true, rev: _chatRev(me) };
      for (const k in (extra || {})) out[k] = extra[k];
      return _json(out);
    };
    const find = (rows, other) => rows.filter(r => r.pair === _chatPair(me, other))[0] || null;

    if (action === "request") {
      const to = _contribUser(body.to);
      if (!CHAT_NAME_RE.test(to)) return _chatErr("bad_name", "Usernames are 3-20 letters, numbers, _ . or -.");
      if (to === me) return _chatErr("self", "You can't add yourself.");
      if (!_chatApprovedNames()[to]) return _chatErr("no_user", "No verified user named \"" + to + "\".");

      const sheet = _chatFriendsSheet();
      const rows = _chatFriendRows();
      const hit = find(rows, to);
      if (hit) {
        if (hit.status === "accepted") return done({ state: "friend" });
        if (hit.from === me) return done({ state: "outgoing" });
        // They already asked you: asking back is the same as accepting.
        sheet.getRange(hit.row, 4, 1, 2).setValues([["accepted", new Date()]]);
        _profileLink(me, to);
        _chatBump([me, to]);
        return done({ state: "friend" });
      }
      const mine = rows.filter(r => r.from === me || r.to === me);
      if (mine.length >= CHAT_MAX_FRIENDS) return _chatErr("full", "Your friend list is full.");
      if (mine.filter(r => r.status === "pending" && r.from === me).length >= CHAT_MAX_OUTGOING) {
        return _chatErr("too_many", "You have too many open requests. Wait for some answers first.");
      }
      const at = sheet.getLastRow() + 1;
      sheet.getRange(at, 1, 1, 3).setNumberFormat("@");
      sheet.getRange(at, 1, 1, 5).setValues([[_chatPair(me, to), me, to, "pending", new Date()]]);
      _chatBump([me, to]);
      return done({ state: "outgoing" });
    }

    if (action === "accept" || action === "decline" || action === "cancel") {
      const other = _contribUser(action === "cancel" ? body.to : body.from);
      if (!CHAT_NAME_RE.test(other)) return _chatErr("bad_name", "Who?");
      const sheet = _chatFriendsSheet();
      const hit = find(_chatFriendRows(), other);
      if (!hit) return _chatErr("no_request", "That request isn't there any more.");
      if (hit.status === "accepted") return done({ state: action === "accept" ? "friend" : "none" });
      // accept/decline only work on a request addressed to you; cancel on one you sent.
      if (action === "cancel" ? hit.from !== me : hit.to !== me) return _chatErr("no_request", "That request isn't there any more.");
      if (action === "accept") { sheet.getRange(hit.row, 4, 1, 2).setValues([["accepted", new Date()]]); _profileLink(me, other); }
      else sheet.deleteRow(hit.row);
      _chatBump([me, other]);
      return done({ state: action === "accept" ? "friend" : "none" });
    }

    if (action === "remove") {
      const other = _contribUser(body.name);
      if (!CHAT_NAME_RE.test(other)) return _chatErr("bad_name", "Who?");
      const hit = find(_chatFriendRows(), other);
      if (hit) _chatFriendsSheet().deleteRow(hit.row);
      _chatDeleteMessages(_chatPair(me, other));
      if (hit && hit.status === "accepted") _profileUnlink(me, other);
      _chatBump([me, other]);
      return done({ state: "none" });
    }

    if (action === "send") {
      const to = _contribUser(body.to);
      const text = _chatClean(body.text);
      if (!CHAT_NAME_RE.test(to)) return _chatErr("bad_name", "Who is this for?");
      if (!text) return _chatErr("empty", "Say something first.");
      const hit = find(_chatFriendRows(), to);
      if (!hit || hit.status !== "accepted") return _chatErr("not_friends", "You can only message accepted friends.");

      const rk = "chatrl:" + me;
      let used = 0;
      try { used = Number(_cache().get(rk)) || 0; } catch (err) {}
      if (used >= CHAT_RATE_MAX) return _chatErr("slow", "Slow down a little.");
      try { _cache().put(rk, String(used + 1), CHAT_RATE_SECS); } catch (err) {}

      const sheet = _chatMessagesSheet();
      const at = sheet.getLastRow() + 1;
      sheet.getRange(at, 1, 1, 3).setNumberFormat("@");
      sheet.getRange(at, 1, 1, 4).setValues([[hit.pair, me, text, Date.now()]]);
      _chatTrimPair(sheet, hit.pair);
      _chatBump([me, to]);
      return done({});
    }

    return _chatErr("bad_action", "Unknown chat action.");
  });
}

function _chatDeleteMessages(pair) {
  const sheet = _chatMessagesSheet();
  const n = sheet.getLastRow() - 1;
  if (n < 1) return;
  const pairs = sheet.getRange(2, 1, n, 1).getValues();
  for (let i = pairs.length - 1; i >= 0; i--) {
    if (String(pairs[i][0]) === pair) sheet.deleteRow(i + 2);
  }
}

// ── clean-up pass ────────────────────────────────────────────────────────
// Run by hand or daily (installChatCleanupTrigger). Rewrites each chat sheet
// once, only if something has to go.
function chatCleanup() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return "Busy — try again.";
  try {
    const approved = _chatApprovedNames();
    const cutoff = Date.now() - CHAT_PENDING_DAYS * 86400000;

    const fSheet = _chatFriendsSheet();
    const friends = _chatFriendRows();
    const keepF = friends.filter(r => {
      if (!approved[r.from] || !approved[r.to]) return false;
      if (r.status === "accepted") return true;
      if (r.status !== "pending") return false;
      const t = r.updated instanceof Date ? r.updated.getTime() : Date.parse(r.updated);
      return !(t < cutoff);
    });
    if (keepF.length !== friends.length) {
      _chatRewrite(fSheet, keepF.map(r => [r.pair, r.from, r.to, r.status, r.updated]), 5);
    }

    const accepted = {};
    keepF.forEach(r => { if (r.status === "accepted") accepted[r.pair] = true; });

    const mSheet = _chatMessagesSheet();
    const msgs = _chatMessageRows();
    const seen = {};
    const keepM = [];
    for (let i = msgs.length - 1; i >= 0; i--) {          // newest first
      const m = msgs[i];
      if (!accepted[m.pair]) continue;
      seen[m.pair] = (seen[m.pair] || 0) + 1;
      if (seen[m.pair] <= CHAT_MAX_PER_PAIR) keepM.push([m.pair, m.from, m.text, m.ts]);
    }
    keepM.reverse();
    if (keepM.length !== msgs.length) _chatRewrite(mSheet, keepM, 4);

    const touched = {};
    friends.forEach(r => { touched[r.from] = true; touched[r.to] = true; });
    _chatBump(Object.keys(touched));
    let prof = "";
    try { prof = " " + profileCleanup(); } catch (err) { prof = " Profiles: " + _errMsg(err); }
    return "Chat clean-up: " + (friends.length - keepF.length) + " friendship row(s) and " + (msgs.length - keepM.length) + " message(s) removed." + prof;
  } finally {
    lock.releaseLock();
  }
}

function _chatRewrite(sheet, rows, width) {
  const max = sheet.getMaxRows();
  if (max > 1) sheet.getRange(2, 1, max - 1, width).clearContent();
  if (!rows.length) return;
  if (sheet.getMaxRows() < rows.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  sheet.getRange(2, 1, rows.length, Math.min(3, width)).setNumberFormat("@");
  sheet.getRange(2, 1, rows.length, width).setValues(rows);
}

function installChatCleanupTrigger() {
  const exists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === "chatCleanup");
  if (!exists) ScriptApp.newTrigger("chatCleanup").timeBased().everyDays(1).atHour(4).create();
  return exists ? "chatCleanup trigger already installed." : "chatCleanup trigger installed (daily, around 4am).";
}

// ── ProfileNet: profile, connections and avatar ──────────────────────────
// One row per approved ticket in the sheet ProfileNetWS (made on first use if
// you haven't pasted the header row yourself; headers are matched by name, so
// column order doesn't matter and a missing column is added on the right).
//
//   Name | ClientID | Key | TicketID      copied from TicketApprovalWS. They are
//                                          only a record: every request is
//                                          checked against the ticket sheet, and
//                                          Key/ClientID are never sent to anyone.
//   DisplayName | Bio                      free text (32 / 300 chars)
//   Visibility                             private (default) | public
//                                          public shows Bio, avatars and
//                                          ConnectionsPublic to other users
//   FavVisibility                          public (default) | private
//   ConnectionsPublic                      "TheTruth|TRIPPY|Elmo"  max 12
//   ConnectionsPrivate                     same format, no limit (cell-safe cap 2000)
//   FavConnections                         same format, max 6, must be people listed
//                                          in one of the two connection lists
//   Avatar50 | Avatar128 | Avatar256       data URLs (webp; gif at 50 and 256)
//   Updated                                ISO time of the last change
//
// GET  ?type=profile&ticket&key[&user=<name>][&variant=50|128|256]
//        no user = your own full record; a user = what that person lets others see
// POST { type:"profile", action, ticket, key, ... }
//        save {displayName, bio, visibility, favVisibility, connectionsPublic,
//              connectionsPrivate, favConnections}   (send only what changed;
//              lists are "a|b|c" strings or arrays)
//        avatar {variant, dataUrl} · avatar_remove {variant}
//
// Accepting a friend request in WannaChat adds each person to the other's
// ConnectionsPrivate (removing the friend takes them out again), so the sheet
// always records who can talk to whom.
const PROFILE_SHEET_NAME   = "ProfileNetWS";
const PROFILE_HEADERS = [
  "Name", "ClientID", "Key", "TicketID", "DisplayName", "Bio", "Visibility", "FavVisibility",
  "ConnectionsPublic", "ConnectionsPrivate", "FavConnections", "Avatar50", "Avatar128", "Avatar256", "Updated",
];
const PROFILE_FAV_MAX      = 6;
const PROFILE_PUBLIC_MAX   = 12;
const PROFILE_PRIVATE_MAX  = 2000;   // keeps the cell under Sheets' 50,000-character limit
const PROFILE_DISPLAY_MAX  = 32;
const PROFILE_BIO_MAX      = 300;
const PROFILE_DATAURL_MAX  = 45000;  // hard limit for one avatar cell (Sheets allows 50,000)
const PROFILE_VARIANTS = {
  "50":  { px: 50,  types: ["webp", "gif"] },
  "128": { px: 128, types: ["webp"] },
  "256": { px: 256, types: ["webp", "gif"] },
};

function _pfNorm(h) { return String(h == null ? "" : h).toLowerCase().replace(/[^a-z0-9]/g, ""); }

function _profileSheet() {
  let sheet = _sheet(PROFILE_SHEET_NAME, false);
  if (!sheet) {
    sheet = _book().insertSheet(PROFILE_SHEET_NAME);
    sheet.appendRow(PROFILE_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// { field: 1-based column } for every PROFILE_HEADERS entry; missing ones are added.
function _profileCols(sheet) {
  const width = Math.max(1, sheet.getLastColumn());
  const header = sheet.getRange(1, 1, 1, width).getValues()[0];
  const cols = {};
  header.forEach((h, i) => { const k = _pfNorm(h); if (k && !cols[k]) cols[k] = i + 1; });
  let next = header.length;
  while (next > 0 && _blank(header[next - 1])) next--;
  PROFILE_HEADERS.forEach(h => {
    const k = _pfNorm(h);
    if (!cols[k]) { next++; sheet.getRange(1, next).setValue(h); cols[k] = next; }
  });
  return cols;
}

// lower-case username -> { id, name, clientId, key, approved } from TicketApprovalWS.
function _profileTickets() {
  const out = {};
  const sheet = _ticketSheet();
  if (!sheet || sheet.getLastRow() < 2) return out;
  const values = sheet.getDataRange().getValues();
  const find = (n, fb) => { const i = values[0].findIndex(h => _key(h) === _key(n)); return i === -1 ? fb : i; };
  const c = { id: find("TicketID", 1), name: find("Name", 2), status: find("Status", 4), client: find("ClientID", 5), key: find("Key", 6) };
  const cell = (r, i) => (i < 0 ? "" : String(values[r][i] == null ? "" : values[r][i]).trim());
  for (let r = 1; r < values.length; r++) {
    const name = cell(r, c.name).replace(/^'/, "");
    const low = _contribUser(name);
    if (!low) continue;
    out[low] = { id: cell(r, c.id), name: name, clientId: cell(r, c.client), key: cell(r, c.key), approved: _ticketIsApproved(_key(values[r][c.status])) };
  }
  return out;
}

function _profileFind(sheet, cols, low) {
  const n = sheet.getLastRow() - 1;
  if (n < 1) return 0;
  const names = sheet.getRange(2, cols.name, n, 1).getValues();
  for (let i = 0; i < n; i++) if (_contribUser(names[i][0]) === low) return i + 2;
  return 0;
}

function _profileSplit(v) {
  return String(v == null ? "" : v).split("|").map(s => s.trim()).filter(Boolean);
}

function _profileRead(sheet, cols, row) {
  const width = sheet.getLastColumn();
  const r = sheet.getRange(row, 1, 1, width).getValues()[0];
  const g = (f) => { const v = r[cols[_pfNorm(f)] - 1]; return v == null ? "" : String(v); };
  return {
    row: row, name: g("Name"), displayName: g("DisplayName"), bio: g("Bio"),
    visibility: _key(g("Visibility")) === "public" ? "public" : "private",
    favVisibility: _key(g("FavVisibility")) === "private" ? "private" : "public",
    pub: _profileSplit(g("ConnectionsPublic")), priv: _profileSplit(g("ConnectionsPrivate")), fav: _profileSplit(g("FavConnections")),
    avatars: { "50": g("Avatar50"), "128": g("Avatar128"), "256": g("Avatar256") },
    updated: g("Updated"),
  };
}

// Creates the row on first use. Name/ClientID/Key/TicketID always come from the ticket sheet.
function _profileEnsure(sheet, cols, low, tickets) {
  const t = tickets[low];
  if (!t || !t.approved) return 0;
  let row = _profileFind(sheet, cols, low);
  if (row) {
    _profileSet(sheet, cols, row, { TicketID: t.id, ClientID: t.clientId, Key: t.key });
    return row;
  }
  row = sheet.getLastRow() + 1;
  if (sheet.getMaxRows() < row) sheet.insertRowsAfter(sheet.getMaxRows(), row - sheet.getMaxRows());
  const vals = { Name: t.name, ClientID: t.clientId, Key: t.key, TicketID: t.id, DisplayName: "", Bio: "",
    Visibility: "private", FavVisibility: "public", ConnectionsPublic: "", ConnectionsPrivate: "", FavConnections: "",
    Avatar50: "", Avatar128: "", Avatar256: "", Updated: new Date().toISOString() };
  const arr = new Array(sheet.getLastColumn()).fill("");
  PROFILE_HEADERS.forEach(h => { arr[cols[_pfNorm(h)] - 1] = vals[h]; });
  const rng = sheet.getRange(row, 1, 1, arr.length);
  rng.setNumberFormat("@");
  rng.setValues([arr]);
  return row;
}

// Writes only the named cells (plain text, so "=1+1" stays text); Updated is stamped for real changes.
function _profileSet(sheet, cols, row, fields, stamp) {
  const cur = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  let changed = false;
  Object.keys(fields).forEach(h => {
    const c = cols[_pfNorm(h)];
    const v = String(fields[h] == null ? "" : fields[h]);
    if (String(cur[c - 1] == null ? "" : cur[c - 1]) === v) return;
    const rng = sheet.getRange(row, c);
    rng.setNumberFormat("@");
    rng.setValue(v);
    changed = true;
  });
  if (changed && stamp) {
    const u = sheet.getRange(row, cols.updated);
    u.setNumberFormat("@");
    u.setValue(new Date().toISOString());
  }
}

// "a|b|c" string or array -> { list } (de-duplicated, case-insensitive) or { error }.
function _profileList(v, label) {
  const parts = Array.isArray(v) ? v : String(v == null ? "" : v).split("|");
  const seen = {}, list = [];
  for (let i = 0; i < parts.length; i++) {
    const n = String(parts[i] == null ? "" : parts[i]).trim().replace(/^@/, "");
    if (!n) continue;
    if (!TICKET_USERNAME_RE.test(n)) return { error: label + ": \"" + n.slice(0, 24) + "\" isn't a valid username (3-20 letters, numbers, _ . or -)." };
    const k = n.toLowerCase();
    if (!seen[k]) { seen[k] = true; list.push(n); }
  }
  return { list: list };
}

// Use each person's real capitalisation when they exist.
function _profileCase(list, tickets) {
  return list.map(n => (tickets[n.toLowerCase()] ? tickets[n.toLowerCase()].name : n));
}

function _profileView(p, tickets, owner, variant) {
  const t = tickets[_contribUser(p.name)];
  const shownName = t ? t.name : p.name;
  const out = { name: shownName, displayName: p.displayName || shownName };
  const showAll = owner || p.visibility === "public";
  if (owner) { out.visibility = p.visibility; out.favVisibility = p.favVisibility; out.connectionsPrivate = p.priv; }
  if (showAll) { out.bio = p.bio; out.connectionsPublic = p.pub; }
  if (owner || p.favVisibility === "public") out.favConnections = p.fav;
  if (showAll) {
    out.avatars = { "50": !!p.avatars["50"], "128": !!p.avatars["128"], "256": !!p.avatars["256"] };
    const url = p.avatars[variant] || "";
    out.avatar = url ? { variant: variant, dataUrl: url } : null;
  }
  out.updated = p.updated;
  return out;
}

const PROFILE_LIMITS = { fav: PROFILE_FAV_MAX, public: PROFILE_PUBLIC_MAX, display: PROFILE_DISPLAY_MAX, bio: PROFILE_BIO_MAX, dataUrl: PROFILE_DATAURL_MAX };

function _profileGet(params) {
  const me = _chatAuth(params.ticket, params.key);
  if (!me) return _chatErr("ticket", "Profiles need your own approved ticket.");
  const variant = PROFILE_VARIANTS[String(params.variant)] ? String(params.variant) : "50";
  const want = params.user ? _contribUser(params.user) : me;
  const tickets = _profileTickets();
  if (!tickets[want] || !tickets[want].approved) return _chatErr("no_user", "No verified user named \"" + String(want).slice(0, 24) + "\".");

  const sheet = _profileSheet();
  const cols = _profileCols(sheet);
  const row = _profileFind(sheet, cols, want);
  const p = row ? _profileRead(sheet, cols, row) : {
    row: 0, name: tickets[want].name, displayName: "", bio: "", visibility: "private", favVisibility: "public",
    pub: [], priv: [], fav: [], avatars: { "50": "", "128": "", "256": "" }, updated: "",
  };
  return _json({ ok: true, me: me, self: want === me, limits: PROFILE_LIMITS, profile: _profileView(p, tickets, want === me, variant) });
}

function _profilePost(body) {
  if (!body || typeof body !== "object") return _chatErr("bad_request", "Bad request.");
  const me = _chatAuth(body.ticket, body.key);
  if (!me) return _chatErr("ticket", "Profiles need your own approved ticket.");
  const action = _key(body.action);

  return _withLock(() => {
    const tickets = _profileTickets();
    const sheet = _profileSheet();
    const cols = _profileCols(sheet);
    const row = _profileEnsure(sheet, cols, me, tickets);
    if (!row) return _chatErr("ticket", "Profiles need your own approved ticket.");

    if (action === "save") {
      const cur = _profileRead(sheet, cols, row);
      const f = {};
      const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
      if (body.displayName !== undefined) f.DisplayName = clean(body.displayName, PROFILE_DISPLAY_MAX);
      if (body.bio !== undefined) f.Bio = clean(body.bio, PROFILE_BIO_MAX);
      if (body.visibility !== undefined) {
        const v = _key(body.visibility);
        if (v !== "public" && v !== "private") return _chatErr("bad_value", "Visibility is public or private.");
        f.Visibility = v;
      }
      if (body.favVisibility !== undefined) {
        const v = _key(body.favVisibility);
        if (v !== "public" && v !== "private") return _chatErr("bad_value", "Favorites visibility is public or private.");
        f.FavVisibility = v;
      }

      let pub = cur.pub, priv = cur.priv, fav = cur.fav;
      const parse = (v, label) => _profileList(v, label);
      const gotPub = body.connectionsPublic !== undefined, gotPriv = body.connectionsPrivate !== undefined, gotFav = body.favConnections !== undefined;
      if (gotPub)  { const r = parse(body.connectionsPublic,  "Public connections");  if (r.error) return _chatErr("bad_list", r.error); pub = r.list; }
      if (gotPriv) { const r = parse(body.connectionsPrivate, "Private connections"); if (r.error) return _chatErr("bad_list", r.error); priv = r.list; }
      if (gotFav)  { const r = parse(body.favConnections,     "Favorites");           if (r.error) return _chatErr("bad_list", r.error); fav = r.list; }

      const notMe = (n) => n.toLowerCase() !== me;
      pub = _profileCase(pub.filter(notMe), tickets);
      priv = _profileCase(priv.filter(notMe), tickets);
      fav = _profileCase(fav.filter(notMe), tickets);

      // A person is in one list or the other: whichever list was just sent wins.
      const inList = (list, n) => list.some(x => x.toLowerCase() === n.toLowerCase());
      if (gotPub && gotPriv && pub.some(n => inList(priv, n))) return _chatErr("overlap", "Someone can't be both public and private.");
      if (gotPub && !gotPriv) priv = priv.filter(n => !inList(pub, n));
      if (gotPriv && !gotPub) pub = pub.filter(n => !inList(priv, n));

      if (pub.length > PROFILE_PUBLIC_MAX) return _chatErr("too_many_public", "Public connections are limited to " + PROFILE_PUBLIC_MAX + ".");
      if (priv.length > PROFILE_PRIVATE_MAX) return _chatErr("too_many_private", "Private connections are limited to " + PROFILE_PRIVATE_MAX + ".");
      if (fav.length > PROFILE_FAV_MAX) return _chatErr("too_many_fav", "Favorites are limited to " + PROFILE_FAV_MAX + ".");
      const known = pub.concat(priv);
      if (gotFav) {
        const stray = fav.filter(n => !inList(known, n))[0];
        if (stray) return _chatErr("fav_unknown", "\"" + stray + "\" has to be in your public or private connections first.");
      } else {
        fav = fav.filter(n => inList(known, n));       // keep favorites valid when a connection goes
      }

      if (gotPub || gotPriv || gotFav) {
        f.ConnectionsPublic = pub.join("|");
        f.ConnectionsPrivate = priv.join("|");
        f.FavConnections = fav.join("|");
      }
      _profileSet(sheet, cols, row, f, true);
      _chatBump([me]);
      const p = _profileRead(sheet, cols, row);
      return _json({ ok: true, limits: PROFILE_LIMITS, profile: _profileView(p, tickets, true, "50") });
    }

    if (action === "avatar" || action === "avatar_remove") {
      const variant = String(body.variant);
      const spec = PROFILE_VARIANTS[variant];
      if (!spec) return _chatErr("bad_variant", "Avatar sizes are 50, 128 or 256.");
      const header = "Avatar" + variant;
      if (action === "avatar_remove") {
        _profileSet(sheet, cols, row, { [header]: "" }, true);
        return _json({ ok: true, variant: variant, removed: true });
      }
      const v = _profileCheckImage(body.dataUrl, spec);
      if (v.error) return _chatErr(v.code, v.error);
      _profileSet(sheet, cols, row, { [header]: v.dataUrl }, true);
      return _json({ ok: true, variant: variant, type: v.type, length: v.dataUrl.length });
    }

    return _chatErr("bad_action", "Unknown profile action.");
  });
}

// Checks prefix, size, base64, file signature and the real pixel size.
// WebP (static) at every size; GIF (animation kept as sent) at 50 and 256.
function _profileCheckImage(dataUrl, spec) {
  const s = typeof dataUrl === "string" ? dataUrl : "";
  if (!s) return { code: "empty", error: "No image sent." };
  if (s.length > PROFILE_DATAURL_MAX) return { code: "too_big", error: "That image is " + s.length + " characters; the limit is " + PROFILE_DATAURL_MAX + ". Try a smaller size or lower quality." };
  const m = /^data:image\/(webp|gif);base64,([A-Za-z0-9+\/]+={0,2})$/.exec(s);
  if (!m) return { code: "bad_format", error: "Only WebP and GIF images are accepted." };
  const type = m[1];
  if (spec.types.indexOf(type) === -1) return { code: "bad_format", error: type.toUpperCase() + " isn't allowed at " + spec.px + "×" + spec.px + "." };
  let b;
  try { b = Utilities.base64Decode(m[2]).map(x => x & 255); } catch (err) { return { code: "bad_image", error: "That image data is damaged." }; }
  const str = (a, z) => String.fromCharCode.apply(null, b.slice(a, z));
  let w = 0, h = 0;
  if (type === "gif") {
    if (b.length < 10 || (str(0, 6) !== "GIF87a" && str(0, 6) !== "GIF89a")) return { code: "bad_image", error: "That isn't a real GIF." };
    w = b[6] | (b[7] << 8); h = b[8] | (b[9] << 8);
  } else {
    if (b.length < 30 || str(0, 4) !== "RIFF" || str(8, 12) !== "WEBP") return { code: "bad_image", error: "That isn't a real WebP." };
    const chunk = str(12, 16);
    if (chunk === "VP8 ") { w = (b[26] | (b[27] << 8)) & 0x3FFF; h = (b[28] | (b[29] << 8)) & 0x3FFF; }
    else if (chunk === "VP8L") { w = 1 + (b[21] | ((b[22] & 0x3F) << 8)); h = 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0F) << 10)); }
    else if (chunk === "VP8X") {
      if (b[20] & 0x02) return { code: "animated_webp", error: "Animated WebP isn't supported; use a GIF at 50 or 256." };
      w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16)); h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    } else return { code: "bad_image", error: "That WebP can't be read." };
  }
  if (w !== spec.px || h !== spec.px) return { code: "bad_size", error: "The image is " + w + "×" + h + "; this slot needs exactly " + spec.px + "×" + spec.px + "." };
  return { dataUrl: s, type: type };
}

// ── hooks used by WannaChat ──────────────────────────────────────────────
// Called inside the chat lock; a profile problem must never break chat.
function _profileLink(a, b) {
  try {
    const tickets = _profileTickets();
    const sheet = _profileSheet();
    const cols = _profileCols(sheet);
    [[a, b], [b, a]].forEach(pair => {
      const row = _profileEnsure(sheet, cols, pair[0], tickets);
      if (!row) return;
      const p = _profileRead(sheet, cols, row);
      const has = (list) => list.some(x => x.toLowerCase() === pair[1]);
      if (has(p.pub) || has(p.priv)) return;
      const other = tickets[pair[1]] ? tickets[pair[1]].name : pair[1];
      if (p.priv.length >= PROFILE_PRIVATE_MAX) return;
      _profileSet(sheet, cols, row, { ConnectionsPrivate: p.priv.concat(other).join("|") }, true);
    });
  } catch (err) {}
}

function _profileUnlink(a, b) {
  try {
    const sheet = _profileSheet();
    const cols = _profileCols(sheet);
    [[a, b], [b, a]].forEach(pair => {
      const row = _profileFind(sheet, cols, pair[0]);
      if (!row) return;
      const p = _profileRead(sheet, cols, row);
      const drop = (list) => list.filter(x => x.toLowerCase() !== pair[1]);
      _profileSet(sheet, cols, row, {
        ConnectionsPublic: drop(p.pub).join("|"), ConnectionsPrivate: drop(p.priv).join("|"), FavConnections: drop(p.fav).join("|"),
      }, true);
    });
  } catch (err) {}
}

// Part of chatCleanup(): rows whose ticket is gone or not approved, and repeats of a name, go.
function profileCleanup() {
  const tickets = _profileTickets();
  const sheet = _profileSheet();
  const cols = _profileCols(sheet);
  const n = sheet.getLastRow() - 1;
  if (n < 1) return "Profiles: nothing to tidy.";
  const names = sheet.getRange(2, cols.name, n, 1).getValues();
  const seen = {};
  const doomed = [];
  for (let i = 0; i < n; i++) {
    const low = _contribUser(names[i][0]);
    if (!low || !tickets[low] || !tickets[low].approved || seen[low]) doomed.push(i + 2);
    else seen[low] = true;
  }
  for (let i = doomed.length - 1; i >= 0; i--) sheet.deleteRow(doomed[i]);
  return "Profiles: " + doomed.length + " row(s) removed.";
}
