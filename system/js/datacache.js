"use strict";

// ── Data cache (Settings → Page behaviour → Data cache) ────────────────
// Off by default. When on, the main page fetches from DATA (data.gs) once,
// saves what came back, and builds every later load from that saved copy
// without contacting DATA at all, until the user presses R to refetch
// (which refreshes the copy too).
//
// Covered feeds (one localStorage key each):
//   ws_cache_assets        the asset list (main.js loadAssets)
//   ws_cache_quotes        the quote box (quotes.js)
//   ws_cache_searchquotes  the search-box quotes (main.js)
// Turning the cache off deletes them; Clear My Data does too.
//
// Each copy is plain text: "WSC1:" + base64( deflate( JSON ) ), or
// "WSJ1:" + JSON where the browser can't compress. Before it's turned into
// JSON, a list of rows ({ title, author, … } objects) is packed as
// { "$cols": [...keys], "$rows": [[...values], …] }, so the field names
// aren't repeated 1,000+ times; unpacking gives back the same objects, and
// the page builds the assets from them exactly as it would from a fetch.
// A copy over MAX_CHARS isn't saved at all, so it can't crowd out the
// rest of the site's saved data.
//
// window.WS_DataCache = { enabled(), setEnabled(on), read(name), write(name, data),
//                         clear(), info(), savedAt(name) }
(() => {
  const ON_KEY    = "ws_data_cache_on";
  const PREFIX    = "ws_cache_";
  const NAMES     = ["assets", "quotes", "searchquotes"];
  const MAX_CHARS = 2500000;   // per copy, well under the ~5M localStorage allows in total

  const canCompress = typeof CompressionStream === "function" && typeof DecompressionStream === "function";

  const get = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const enabled = () => get(ON_KEY) === "1";

  // ── Packing: rows of objects ⇄ columns + value arrays ────────────────
  const isRowList = (d) => Array.isArray(d) && d.length > 0 &&
    d.every((r) => r && typeof r === "object" && !Array.isArray(r));

  function pack(data) {
    if (!isRowList(data)) return data;
    const cols = [];
    const seen = new Set();
    for (const r of data) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
    return { $cols: cols, $rows: data.map((r) => cols.map((c) => (c in r ? r[c] : null))) };
  }

  function unpack(data) {
    if (!data || !Array.isArray(data.$cols) || !Array.isArray(data.$rows)) return data;
    return data.$rows.map((vals) => {
      const o = {};
      data.$cols.forEach((c, i) => { if (vals[i] !== null && vals[i] !== undefined) o[c] = vals[i]; });
      return o;
    });
  }

  // ── Text encoding ────────────────────────────────────────────────────
  async function streamBytes(bytes, transform) {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());
  }
  function toBase64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromBase64(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  async function encode(data) {
    const json = JSON.stringify({ v: 1, savedAt: new Date().toISOString(), data: pack(data) });
    if (!canCompress) return "WSJ1:" + json;
    return "WSC1:" + toBase64(await streamBytes(new TextEncoder().encode(json), new CompressionStream("deflate")));
  }

  async function decode(text) {
    if (!text) return null;
    let json;
    if (text.startsWith("WSC1:")) {
      if (!canCompress) return null;
      json = new TextDecoder().decode(await streamBytes(fromBase64(text.slice(5)), new DecompressionStream("deflate")));
    } else if (text.startsWith("WSJ1:")) {
      json = text.slice(5);
    } else return null;
    const obj = JSON.parse(json);
    return obj && obj.v === 1 ? { savedAt: obj.savedAt, data: unpack(obj.data) } : null;
  }

  // ── API ──────────────────────────────────────────────────────────────
  // The saved copy of a feed, or null (cache off, nothing saved, or the
  // copy can't be read — then the caller just fetches as usual).
  async function read(name) {
    if (!enabled() || !NAMES.includes(name)) return null;
    try {
      const hit = await decode(get(PREFIX + name));
      return hit ? hit.data : null;
    } catch (err) {
      console.warn(`[DataCache] Couldn't read the saved ${name}; fetching instead.`, err);
      return null;
    }
  }

  // Saves a feed's data (only while the cache is on). Resolves false if it
  // wasn't saved: too big, storage full, or cache off.
  async function write(name, data) {
    if (!enabled() || !NAMES.includes(name) || data == null) return false;
    try {
      const text = await encode(data);
      if (text.length > MAX_CHARS) {
        console.warn(`[DataCache] ${name} is too big to save (${text.length} chars).`);
        window.showToast?.(`The ${name} are too big to save offline, so they'll keep being fetched.`, 4000);
        localStorage.removeItem(PREFIX + name);
        return false;
      }
      localStorage.setItem(PREFIX + name, text);
      document.dispatchEvent(new CustomEvent("ws:data-cache-change"));
      return true;
    } catch (err) {
      console.warn(`[DataCache] Couldn't save ${name}:`, err);
      try { localStorage.removeItem(PREFIX + name); } catch (_) {}
      return false;
    }
  }

  function clear() {
    NAMES.forEach((n) => { try { localStorage.removeItem(PREFIX + n); } catch (_) {} });
    document.dispatchEvent(new CustomEvent("ws:data-cache-change"));
  }

  function setEnabled(on) {
    try {
      if (on) localStorage.setItem(ON_KEY, "1");
      else { localStorage.removeItem(ON_KEY); clear(); }
    } catch (_) {}
  }

  // { chars, feeds: [names saved] } — how much is stored, without
  // decoding anything.
  function info() {
    let chars = 0;
    const feeds = [];
    for (const n of NAMES) {
      const t = get(PREFIX + n);
      if (t) { chars += t.length; feeds.push(n); }
    }
    return { chars, feeds };
  }

  // A saved copy's time, for Settings ("Saved 24 Sep, 12:30").
  async function savedAt(name) {
    try { const hit = await decode(get(PREFIX + name)); return hit ? hit.savedAt : null; } catch (_) { return null; }
  }

  window.WS_DataCache = { enabled, setEnabled, read, write, clear, info, savedAt, NAMES, ON_KEY };
})();
