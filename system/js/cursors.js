"use strict";

// ── Custom cursors ─────────────────────────────────────────────────────────
// Site-wide cursor packs, picked and switched on from the store page. Off by
// default: nothing here touches the page until ws_cursors_enabled is "true".
//
// A pack is a folder of five pngs at assets/cursors/<id>/:
//   normal  plain arrow              point  over links/buttons
//   click   while the mouse is held  grab   draggable things
//   deny    disabled / not-allowed
// Drawn at any size on a transparent canvas: each image is trimmed to its
// drawing and scaled down to SIZE px here (browsers ignore cursor images over
// 128px), then cached so the next page paints the cursor instantly.
//
// The site sets its cursors with plain CSS keywords, so instead of guessing
// which elements are clickable, the engine reads the site's own stylesheets
// and re-points every rule's keyword at the matching pack image — anything
// that shows a hand today shows the pack's hand.
//
// Storage:
//   ws_cursors_enabled  "true" when on (set by store.html)
//   ws_active_cursor    the active pack id
//   ws_cursor_size      cursor size in px (16-128, default 32), set on the Settings page
//   ws_cursor_cache     { id, v, size, states } baked images for instant paint
(() => {
  const ENABLED_KEY  = "ws_cursors_enabled";
  const ACTIVE_KEY   = "ws_active_cursor";
  const CACHE_KEY    = "ws_cursor_cache";
  const SIZE_KEY     = "ws_cursor_size";
  const CACHE_VER    = 2;   // bump when baking changes, so old caches rebuild
  const DEFAULT_PACK = "classic";
  // Browsers ignore cursor images over 128px, so that's the ceiling.
  const SIZE_MIN = 16, SIZE_MAX = 128, SIZE_DEFAULT = 32;

  const BASE = new URL("../../assets/cursors/", document.currentScript?.src || location.href).href;

  // hot: where each cursor "points", in the source image's own pixels, or
  // "center" for the middle of the drawing. Add a pack: drop its folder in
  // assets/cursors/ and list it here.
  const PACKS = {
    classic: {
      name: "Classic",
      hot: { normal: [106, 91], point: [165, 74], click: [112, 104], grab: "center", deny: "center" },
    },
  };
  const STATES = ["normal", "point", "click", "grab", "deny"];

  // CSS keyword -> pack state. Keywords not listed (text, resizes, wait, …)
  // have no pack image and keep the native cursor.
  const KEYWORD_STATE = {
    auto: "normal", default: "normal",
    pointer: "point",
    grab: "grab", grabbing: "grab",
    "not-allowed": "deny", "no-drop": "deny",
  };
  const FALLBACK = { normal: "default", point: "pointer", click: "pointer", grab: "grab", deny: "not-allowed" };

  // Adds id-level specificity without matching anything extra, so a rule can
  // beat the site's own #id selectors.
  const BOOST = ":not(#ws-cur-x):not(#ws-cur-y)";
  const TEXT_FIELDS = `textarea, [contenteditable=""], [contenteditable="true"], input:not([type]),
    input:is([type="text"], [type="search"], [type="email"], [type="url"], [type="tel"], [type="password"], [type="number"])`;

  const root = document.documentElement;
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

  const isEnabled = () => read(ENABLED_KEY) === "true";
  const getActive = () => {
    const id = (read(ACTIVE_KEY) || DEFAULT_PACK).trim().toLowerCase();
    return PACKS[id] ? id : DEFAULT_PACK;
  };
  const clampSize = (n) => {
    n = Math.round(Number(n));
    return Number.isFinite(n) ? Math.max(SIZE_MIN, Math.min(SIZE_MAX, n)) : SIZE_DEFAULT;
  };
  const getSize = () => clampSize(read(SIZE_KEY) ?? SIZE_DEFAULT);
  const rawUrl = (id, state) => new URL(`${encodeURIComponent(id)}/${state}.png`, BASE).href;

  // ── Baking: trim, scale to SIZE, move the hotspot along ─────────────────
  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`couldn't load ${src}`));
      img.src = src;
    });
  }

  function bake(img, hot, size) {
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;   // throws on a tainted canvas (file://)

    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) throw new Error("empty image");

    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const k = Math.min(1, size / Math.max(bw, bh));
    const ow = Math.max(1, Math.round(bw * k)), oh = Math.max(1, Math.round(bh * k));
    const out = Object.assign(document.createElement("canvas"), { width: ow, height: oh });
    const octx = out.getContext("2d");
    octx.imageSmoothingQuality = "high";
    octx.drawImage(c, x0, y0, bw, bh, 0, 0, ow, oh);

    const [hx, hy] = hot === "center" || !hot ? [x0 + bw / 2, y0 + bh / 2] : hot;
    const clamp = (v, max) => Math.max(0, Math.min(max - 1, Math.round(v)));
    return { url: out.toDataURL("image/png"), x: clamp((hx - x0) * k, ow), y: clamp((hy - y0) * k, oh) };
  }

  // Baked per pack AND size, so dragging the size slider back and forth
  // doesn't redo work it has already done.
  const _baking = {};
  function bakePack(id, size = getSize()) {
    const slot = `${id}@${size}`;
    if (_baking[slot]) return _baking[slot];
    const pack = PACKS[id];
    _baking[slot] = Promise.all(STATES.map(async (state) => {
      const img = await loadImg(rawUrl(id, state));
      return [state, bake(img, pack.hot[state], size)];
    })).then(Object.fromEntries).catch((err) => {
      delete _baking[slot];
      throw err;
    });
    return _baking[slot];
  }

  function cachedStates(id, size = getSize()) {
    try {
      const c = JSON.parse(read(CACHE_KEY) || "null");
      return c && c.id === id && c.v === CACHE_VER && c.size === size && c.states ? c.states : null;
    } catch { return null; }
  }

  // ── Reading the site's cursor rules ─────────────────────────────────────
  // Split a selector list on its top-level commas (not the ones inside
  // :is(a, b) and friends).
  function splitSelectors(list) {
    const out = [];
    let depth = 0, start = 0;
    for (let i = 0; i < list.length; i++) {
      const ch = list[i];
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      else if (ch === "," && depth === 0) { out.push(list.slice(start, i)); start = i + 1; }
    }
    out.push(list.slice(start));
    return out.map((s) => s.trim()).filter(Boolean);
  }

  // Put a selector under html.ws-cur; one that already starts at html or
  // :root gets the class added there instead.
  function scope(sel) {
    if (/^(html|:root)(?![\w-])/i.test(sel)) return sel.replace(/^(html|:root)/i, "html.ws-cur");
    return `html.ws-cur ${sel}`;
  }

  // [{ wrap: ["@media …"], selector, keyword }] in source order.
  function collectRules() {
    const found = [];
    const walk = (rules, wrap) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          const val = rule.style.getPropertyValue("cursor").trim().toLowerCase();
          if (val && !val.includes("url(")) found.push({ wrap, selector: rule.selectorText, keyword: val });
        } else if (rule instanceof CSSMediaRule) {
          walk(rule.cssRules, [...wrap, `@media ${rule.conditionText}`]);
        } else if (typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule) {
          walk(rule.cssRules, [...wrap, `@supports ${rule.conditionText}`]);
        } else if (rule.cssRules) {
          walk(rule.cssRules, wrap);   // @layer and other grouping rules
        }
      }
    };
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode?.id === "ws-cursors") continue;
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }   // cross-origin (CDN) sheets
      if (rules) walk(rules, []);
    }
    return found;
  }

  // ── Painting ────────────────────────────────────────────────────────────
  let _states = null;
  let _styleEl = null;

  function styleEl() {
    if (!_styleEl) {
      _styleEl = document.getElementById("ws-cursors") || document.createElement("style");
      _styleEl.id = "ws-cursors";
      if (!_styleEl.isConnected) (document.head || root).appendChild(_styleEl);
    }
    return _styleEl;
  }

  function buildCss(states) {
    const cur = (state) => {
      const s = states[state];
      return `url("${s.url}") ${s.x} ${s.y}, ${FALLBACK[state]}`;
    };
    const valueFor = (keyword) => {
      const state = KEYWORD_STATE[keyword];
      return state ? cur(state) : keyword;
    };
    const decl = (v) => `{ cursor: ${v} !important; }`;

    const css = [
      `html.ws-cur, html.ws-cur *, html.ws-cur *::before, html.ws-cur *::after ${decl(cur("normal"))}`,
      `html.ws-cur a[href], html.ws-cur summary, html.ws-cur select ${decl(cur("point"))}`,
      `html.ws-cur :disabled ${decl(cur("deny"))}`,
    ];

    // The site's own cursor rules, in source order so ties resolve the way
    // they already do (e.g. .btn:disabled after .btn).
    for (const { wrap, selector, keyword } of collectRules()) {
      const kw = keyword.split(",").pop().trim();
      const scoped = splitSelectors(selector).map(scope).join(", ");
      let block = `${scoped} ${decl(valueFor(kw))}`;
      for (let i = wrap.length - 1; i >= 0; i--) block = `${wrap[i]} { ${block} }`;
      css.push(block);
    }

    // Cursors set inline from JS (style="cursor: grab").
    const keywords = [...new Set([...Object.keys(KEYWORD_STATE), "text", "wait", "move", "se-resize", "sw-resize"])];
    for (const kw of keywords) {
      css.push(`html.ws-cur [style*="cursor: ${kw}"]${BOOST}, html.ws-cur [style*="cursor:${kw}"]${BOOST} ${decl(valueFor(kw))}`);
    }

    css.push(`html.ws-cur :is(${TEXT_FIELDS})${BOOST} ${decl("text")}`);
    // Held down anywhere that isn't a text field, a drag handle or disabled.
    css.push(`html.ws-cur.ws-cur-down, html.ws-cur.ws-cur-down *${BOOST}${BOOST} ${decl(cur("click"))}`);
    return css.join("\n");
  }

  function paint() {
    if (!_states || !isEnabled()) return unpaint();
    styleEl().textContent = buildCss(_states);
    root.classList.add("ws-cur");
  }

  function unpaint() {
    root.classList.remove("ws-cur", "ws-cur-down");
    if (_styleEl) _styleEl.textContent = "";
  }

  // Paint from cache right away, then bake (or re-bake) in the background.
  function refresh() {
    if (!isEnabled()) { _states = null; return unpaint(); }
    const id = getActive(), size = getSize();
    _states = cachedStates(id, size);
    paint();
    if (_states) return;
    bakePack(id, size).then((states) => {
      if (getActive() !== id || getSize() !== size) return;   // changed while baking
      write(CACHE_KEY, JSON.stringify({ id, v: CACHE_VER, size, states }));
      _states = states;
      paint();
    }).catch((err) => {
      console.warn(`[cursors] Couldn't build the "${id}" pack, keeping native cursors:`, err.message);
    });
  }

  // ── Mouse held: swap to the click cursor ────────────────────────────────
  // Only when the press starts on something showing the normal or point
  // cursor, so drag handles keep grab and disabled things keep deny.
  document.addEventListener("pointerdown", (e) => {
    if (!root.classList.contains("ws-cur") || e.button !== 0 || !(e.target instanceof Element)) return;
    const fallback = getComputedStyle(e.target).cursor.split(",").pop().trim();
    if (fallback === "default" || fallback === "pointer") root.classList.add("ws-cur-down");
  }, true);
  const release = () => root.classList.remove("ws-cur-down");
  ["pointerup", "pointercancel", "dragend"].forEach((t) => document.addEventListener(t, release, true));
  window.addEventListener("blur", release);

  // ── Keep up with stylesheets added later ────────────────────────────────
  let _rescanQueued = false;
  function rescanSoon() {
    if (_rescanQueued || !root.classList.contains("ws-cur")) return;
    _rescanQueued = true;
    setTimeout(() => { _rescanQueued = false; paint(); }, 50);
  }
  const isSheet = (n) => n.nodeName === "STYLE" ? n.id !== "ws-cursors" : n.nodeName === "LINK" && /stylesheet/i.test(n.rel);
  const watch = (target) => new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (!isSheet(n)) continue;
        if (n.nodeName === "LINK") n.addEventListener("load", rescanSoon, { once: true });
        rescanSoon();
      }
    }
  }).observe(target, { childList: true });
  if (document.head) watch(document.head);
  if (document.body) watch(document.body);
  else document.addEventListener("DOMContentLoaded", () => watch(document.body), { once: true });
  window.addEventListener("load", rescanSoon);

  // Another page or tab (the store) changed the cursor settings.
  window.addEventListener("storage", (e) => {
    if (e.key === ENABLED_KEY || e.key === ACTIVE_KEY || e.key === SIZE_KEY) refresh();
  });

  // Same-tab listeners (the Settings page) can't get a "storage" event for
  // their own writes, so changes announce themselves too.
  const announce = () => document.dispatchEvent(new CustomEvent("ws:cursor-change"));

  window.WSCursors = {
    list: () => Object.entries(PACKS).map(([id, p]) => ({ id, name: p.name })),
    states: STATES,
    isEnabled,
    getActive,
    getName: (id) => PACKS[id]?.name || id,
    sizeMin: SIZE_MIN, sizeMax: SIZE_MAX, sizeDefault: SIZE_DEFAULT,
    getSize,
    // Cursor size in px, clamped to 16-128. The default (32) is stored as
    // "nothing", so a reset leaves no trace.
    setSize(px) {
      const size = clampSize(px);
      write(SIZE_KEY, size === SIZE_DEFAULT ? null : String(size));
      refresh();
      announce();
      return size;
    },
    setEnabled(on) {
      write(ENABLED_KEY, on ? "true" : null);
      refresh();
      announce();
    },
    setActive(id) {
      const key = (id || "").trim().toLowerCase();
      if (!PACKS[key]) return false;
      write(ACTIVE_KEY, key);
      refresh();
      announce();
      return true;
    },
    // Trimmed, cursor-sized images of a pack for previews; the raw files if
    // baking isn't possible (e.g. opened from file://).
    preview(id, size = getSize()) {
      size = clampSize(size);
      const cached = cachedStates(id, size);
      if (cached) return Promise.resolve(Object.fromEntries(STATES.map((s) => [s, cached[s].url])));
      return bakePack(id, size)
        .then((states) => Object.fromEntries(STATES.map((s) => [s, states[s].url])))
        .catch(() => Object.fromEntries(STATES.map((s) => [s, rawUrl(id, s)])));
    },
  };

  refresh();
})();
