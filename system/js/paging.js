"use strict";

// ── Paging settings ────────────────────────────────────────────────────
// Set on the Settings page (pages/settings.html), read by main.js. Saved
// per browser:
//
//   ws_paging_layout  "paged" (default) | "pageless"
//   sortMode          "sheet" (default) | "alphabetical"   (utils.js getSortMode)
//   ws_alpha_scope    "global" (default) | "local"   paged A–Z: sort the whole
//                     library and deal it back into the pages, or sort
//                     inside each sheet page only
//   ws_filter_scope   "local" (default) | "global"   category/sub-category filters
//   ws_search_scope   "global" (default) | "local"   text search
//   ws_flip_align     "1" = scroll to the top when flipping pages (default off)
//   ws_data_cache_on  "1" = data cache (datacache.js): load from a saved copy
//                     of the fetched data until R refetches (default off).
//                     Not a paging option, so pageless leaves it alone;
//                     turning it off deletes the saved copy.
//
// Layout × order (× A–Z scope) × filter scope gives eight paging systems:
//   1 Paged · sheet order · filters per page   (default)
//   2 Paged · sheet order · filters on all pages
//   3 Paged · A–Z within pages · filters per page
//   4 Paged · A–Z within pages · filters on all pages
//   5 Paged · A–Z across pages · filters per page
//   6 Paged · A–Z across pages · filters on all pages
//   7 Pageless · sheet order
//   8 Pageless · A–Z
// Pageless has no pages, so the A–Z scope, filter scope, search scope and
// flip align don't apply to it; effective() reports them as off/global
// there and the Settings page greys them out.
//
// Changes (here, or from the Settings page in another tab) fire
// "ws:paging-changed" on document.
(() => {
  const KEYS = {
    layout:      "ws_paging_layout",
    order:       "sortMode",
    alphaScope:  "ws_alpha_scope",
    filterScope: "ws_filter_scope",
    searchScope: "ws_search_scope",
    flipAlign:   "ws_flip_align",
    cache:       "ws_data_cache_on",
  };
  const DEFAULTS = { layout: "paged", order: "sheet", alphaScope: "global", filterScope: "local", searchScope: "global", flipAlign: false, cache: false };
  const FLAGS    = ["flipAlign", "cache"];   // "1" or absent
  const ALLOWED  = {
    layout:      ["paged", "pageless"],
    order:       ["sheet", "alphabetical"],
    alphaScope:  ["global", "local"],
    filterScope: ["local", "global"],
    searchScope: ["global", "local"],
  };

  const read = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };

  function get() {
    // debug.html edits the sheet's own page/row order, so it always shows that
    // order (paged, sheet order), whatever this browser's Settings say.
    if (window.__WS_DEBUG) return { layout: "paged", order: "sheet", alphaScope: "global", filterScope: "local", searchScope: "global", flipAlign: false, cache: false };
    const out = {};
    for (const [name, allowed] of Object.entries(ALLOWED)) {
      const v = read(KEYS[name]);
      out[name] = allowed.includes(v) ? v : DEFAULTS[name];
    }
    for (const flag of FLAGS) out[flag] = read(KEYS[flag]) === "1";
    return out;
  }

  // What main.js should actually do, with the pageless overrides applied.
  function effective() {
    const s = get();
    if (s.layout === "pageless") {
      s.filterScope = "global";
      s.searchScope = "global";
      s.flipAlign   = false;
    }
    return s;
  }

  const SYSTEM_COUNT = 8;

  // Which of the eight systems (see the table above) is on.
  function systemNumber(s = get()) {
    if (s.layout === "pageless") return s.order === "alphabetical" ? 8 : 7;
    const base = s.order !== "alphabetical" ? 1 : s.alphaScope === "local" ? 3 : 5;
    return base + (s.filterScope === "global" ? 1 : 0);
  }

  // Paged A–Z across pages: the pages keep their sizes but are refilled
  // from the whole library in A–Z order.
  const regrouped = (s = get()) => s.layout === "paged" && s.order === "alphabetical" && s.alphaScope === "global";

  const changed = () => document.dispatchEvent(new CustomEvent("ws:paging-changed", { detail: get() }));

  function set(name, value) {
    if (!(name in KEYS)) return;
    try {
      if (FLAGS.includes(name)) {
        if (value) localStorage.setItem(KEYS[name], "1");
        else localStorage.removeItem(KEYS[name]);
        if (name === "cache" && !value) window.WS_DataCache?.clear();
      } else if (ALLOWED[name].includes(value)) {
        localStorage.setItem(KEYS[name], value);
      } else return;
    } catch (_) { return; }
    changed();
  }

  function reset() {
    try { Object.values(KEYS).forEach((k) => localStorage.removeItem(k)); } catch (_) {}
    window.WS_DataCache?.clear();
    changed();
  }

  // Sheet order keeps the sheet's pages in order (page 1's assets, then
  // page 2's…). A–Z sorts within each page (paged, local) or across the
  // whole library (paged global, and pageless). Cards carry _page (sheet
  // page), _idx (sheet row order) and _title from main.js.
  function orderCards(cards) {
    const s = get();
    const alpha = s.order === "alphabetical";
    const byPage = s.layout !== "pageless" && !regrouped(s);
    return cards.slice().sort((a, b) =>
      (byPage ? a._page - b._page : 0)
      || (alpha ? fastCompare(a._title, b._title) : 0)
      || a._idx - b._idx);
  }

  // The page each card shows on (_viewPage). Normally its sheet page; for
  // A–Z across pages, the A–Z order is dealt into the sheet's pages, each
  // page keeping the number of assets it has in the sheet.
  function assignViewPages(cards) {
    if (!regrouped()) { for (const c of cards) c._viewPage = c._page; return; }
    const sizes = new Map();
    for (const c of cards) sizes.set(c._page, (sizes.get(c._page) || 0) + 1);
    const sorted = orderCards(cards);
    let i = 0;
    for (const p of [...sizes.keys()].sort((a, b) => a - b)) {
      for (let n = sizes.get(p); n > 0; n--) sorted[i++]._viewPage = p;
    }
  }

  window.addEventListener("storage", (e) => {
    if (e.key === null || Object.values(KEYS).includes(e.key)) changed();
  });

  window.WS_Paging = { KEYS, DEFAULTS, SYSTEM_COUNT, get, effective, systemNumber, regrouped, set, reset, orderCards, assignViewPages };
})();

// ── Bundle settings ────────────────────────────────────────────────────
// How bundled (version) cards look and whether they exist at all, set on the
// Settings page ("Bundles"), read by main.js. Saved per browser:
//
//   ws_bundle_tilt   "right" (default) | "left"   which way the deck of
//                    other versions fans out behind the front card
//   ws_bundle_hide   "1" = keep version assets hidden: rows whose status is
//                    "merge" (ok|merge) are left out when the library is
//                    built, so only the parent asset's card shows (default
//                    off: versions show as a deck behind the parent)
//
// Not part of WS_Paging on purpose: a paging change re-sorts the whole
// library (main.js), which a look-only setting shouldn't do. Changes (here,
// or from another tab) fire "ws:bundle-settings-changed" on document.
(() => {
  const KEYS     = { tilt: "ws_bundle_tilt", hideVersions: "ws_bundle_hide" };
  const DEFAULTS = { tilt: "right", hideVersions: false };
  const FLAGS    = ["hideVersions"];   // "1" or absent
  const ALLOWED  = { tilt: ["right", "left"] };

  const read = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  function get() {
    const out = {};
    for (const [name, allowed] of Object.entries(ALLOWED)) {
      const v = read(KEYS[name]);
      out[name] = allowed.includes(v) ? v : DEFAULTS[name];
    }
    for (const name of FLAGS) out[name] = read(KEYS[name]) === "1";
    return out;
  }
  const changed = () => document.dispatchEvent(new CustomEvent("ws:bundle-settings-changed", { detail: get() }));

  function set(name, value) {
    if (!(name in KEYS)) return;
    const flag = FLAGS.includes(name);
    if (flag ? typeof value !== "boolean" : !ALLOWED[name].includes(value)) return;
    try {
      if (value === DEFAULTS[name]) localStorage.removeItem(KEYS[name]);
      else localStorage.setItem(KEYS[name], flag ? "1" : value);
    } catch (_) { return; }
    changed();
  }
  function reset() {
    try { Object.values(KEYS).forEach((k) => localStorage.removeItem(k)); } catch (_) {}
    changed();
  }

  window.addEventListener("storage", (e) => {
    if (e.key === null || Object.values(KEYS).includes(e.key)) changed();
  });

  window.WS_BundleSettings = { KEYS, DEFAULTS, get, set, reset };
})();
