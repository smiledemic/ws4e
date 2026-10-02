"use strict";

(function initScrollPersistence() {
  const saveScroll = debounce(() => {
    sessionStorage.setItem("scrollY", String(Math.round(window.scrollY)));
  }, 100);
  window.addEventListener("scroll", saveScroll, { passive: true });

  window._restoreScrollY = function () {
    const saved = parseInt(sessionStorage.getItem("scrollY") || "0", 10);
    if (!saved) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        window.scrollTo({ top: saved, behavior: "instant" })
      )
    );
  };
})();

(() => {
  const PAGE_ACCEL     = 0.9;
  const PAGE_FRICTION  = 0.85;
  const PAGE_THRESHOLD = 1;
  const TAP_COOLDOWN   = 300;

  let velocity = 0, lastFlip = 0;
  const keys = { left: false, right: false };

  const canFlip = () =>
    typeof window.nextPage === "function" &&
    typeof window.prevPage === "function" &&
    performance.now() - lastFlip > TAP_COOLDOWN;

  const flipNext = () => { if (!canFlip()) return; lastFlip = performance.now(); window.nextPage(); };
  const flipPrev = () => { if (!canFlip()) return; lastFlip = performance.now(); window.prevPage(); };

  document.addEventListener("keydown", e => {
    if (e.key === "ArrowRight") { keys.right = true; if (!e.repeat) flipNext(); }
    if (e.key === "ArrowLeft")  { keys.left  = true; if (!e.repeat) flipPrev(); }
  });
  document.addEventListener("keyup", e => {
    if (e.key === "ArrowRight") keys.right = false;
    if (e.key === "ArrowLeft")  keys.left  = false;
  });

  (function loop() {
    if (keys.right) velocity += PAGE_ACCEL;
    if (keys.left)  velocity -= PAGE_ACCEL;
    velocity *= PAGE_FRICTION;
    if (velocity >  PAGE_THRESHOLD) { flipNext(); velocity = 0; }
    if (velocity < -PAGE_THRESHOLD) { flipPrev(); velocity = 0; }
    if (Math.abs(velocity) < 0.01) velocity = 0;
    requestAnimationFrame(loop);
  })();
})();

function initGifDrag(gif) {
  const SWAY_STRENGTH = 0.6;
  const RETURN_SPEED  = 0.08;
  const DROP_DURATION = 1600;

  const _getDragTheme = () =>
    document.documentElement.getAttribute("theme") || DEFAULT_THEME;

  let dragging = false, dropping = false;
  let mouseX = 0, mouseY = 0, lastMouseX = 0, rotation = 0;

  new MutationObserver(() => {
    if (gif.style.display !== "none") gif.style.pointerEvents = "auto";
  }).observe(gif, { attributes: true, attributeFilter: ["style"] });

  const _applyDragGif = (key) => {
    const theme = _getDragTheme();
    if (typeof applyGifToImg === "function") {
      applyGifToImg(gif, theme, key);
    } else {
      gif.src = getThemeGifSrc(theme, key) || getThemeGifSrc(theme, "searching");
    }
  };

  gif.addEventListener("mousedown", (e) => {
    if (dropping) return;
    dragging = true;
    _applyDragGif("held");
    gif.style.cursor = "grabbing";
    mouseX = e.clientX; mouseY = e.clientY; lastMouseX = mouseX;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => { mouseX = e.clientX; mouseY = e.clientY; });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false; dropping = true;
    gif.style.cursor = "grab";
    _applyDragGif("drop");
    gif.style.top = (parseFloat(gif.style.top) || 0) + 6 + "px";
    setTimeout(() => { _applyDragGif("searching"); dropping = false; }, DROP_DURATION);
  });

  (function tick() {
    if (dragging) {
      rotation += (mouseX - lastMouseX) * SWAY_STRENGTH;
      rotation *= 0.9;
      gif.style.left = mouseX + "px";
      gif.style.top  = mouseY + "px";
    } else {
      rotation *= (1 - RETURN_SPEED);
    }
    gif.style.transform = `translate(-50%, 0) rotate(${rotation}deg)`;
    lastMouseX = mouseX;
    requestAnimationFrame(tick);
  })();
}

window.addEventListener("load", () => {
  if (typeof Crate !== "undefined") {
    new Crate({ server: "1451796462517096642", channel: "1451796463368667218" });
  }
});

(() => {

  function initElements() {
    const $ = (sel) => {
      try {
        if (!sel) return null;
        return /^[A-Za-z0-9\-_]+$/.test(sel)
          ? document.getElementById(sel)
          : document.querySelector(sel) || null;
      } catch { return null; }
    };

    const devContainer  = document.getElementById("dev-build-container");
    const mainContainer = document.getElementById("container");

    let resolvedContainer, containerMode;
    if (devContainer) {
      resolvedContainer = devContainer;
      containerMode     = "dev";
    } else {
      resolvedContainer = mainContainer;
      containerMode     = "default";
    }

    window._containerMode = containerMode;

    window.dom = {
      container:          resolvedContainer,
      pageIndicator:      $(".page-indicator") || $("#page-indicator"),
      searchInput:        $("#searchInputHeader"),
      searchBtn:          $("#searchBtnHeader"),
      updatePopup:        $("#updatePopup"),
      updatePopupContent: $(".update-popup-content"),
      viewUpdateBtn:      $("#viewUpdateBtn"),
      viewUpdateInfoBtn:  $("#viewUpdateInfoBtn"),
      closeUpdateBtn:     $("#closeUpdateBtn"),
      dontShowBtn:        $("#dontShowBtn"),
      updateVideo:        $("#updateVideo"),
    };

    window.config = {
      fallbackImage:    "https://raw.githubusercontent.com/01110010-00110101/01110010-00110101.github.io/main/system/images/404_blank.png",
      fallbackLink:     "https://wnasmile.github.io./source/dino/",
      // mydex.html's <head> sets WS_SHEET_URL and starts the asset fetch
      // early; this literal is only the fallback for pages that don't.
      sheetUrl:         window.WS_SHEET_URL || window.WS_ENDPOINTS.data,
      devBuildUrl:      "",
    };

    // Sticker list + base path: stickers.js.

    if (!window._activeFetchUrl) {
      window._activeFetchUrl = (containerMode === "dev" || window._devBuildArmedAtLoad)
        ? window.config.devBuildUrl
        : window.config.sheetUrl;
    }
  }

  // ── Favorites ─────────────────────────────────────────────────────────
  // An ordered list of asset keys (lowercased titles), appended to as things
  // are favorited — no timestamps, the list order *is* "when it was added".
  // That order is also the favorites view's paging: FAV_PAGE_SIZE per page,
  // independent of each asset's own sheet page (see renderPage). The ☆ on a
  // card adds/removes; #fav-btn in the header switches the grid between
  // main assets and favorites. Exported/cleared with the rest of the user's
  // data under "ws_favorites" (see data.js).
  const FAV_KEY        = "ws_favorites";
  const FAV_LEGACY_KEY = "favorites";   // the old Set-based favorites
  const FAV_PAGE_SIZE  = 75;            // same cap as a main-asset page
  const IMG_WAIT_MS    = 10000;         // longest one icon may hold up its page's loader

  function initFavorites() {
    let list = [];
    try {
      let raw = localStorage.getItem(FAV_KEY);
      // One-time carry-over of the old favorites so nobody loses theirs.
      if (raw === null && localStorage.getItem(FAV_LEGACY_KEY) !== null) {
        raw = localStorage.getItem(FAV_LEGACY_KEY);
        localStorage.removeItem(FAV_LEGACY_KEY);
      }
      const v = JSON.parse(raw || "[]");
      if (Array.isArray(v)) list = v;
    } catch {}
    list = [...new Set(list.map(s => safeStr(s).toLowerCase().trim()).filter(Boolean))];

    let has = new Set(list);
    const save = () => {
      has = new Set(list);
      try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch {}
    };
    save();

    window.WS_Favorites = {
      list: () => list.slice(),
      has:  (key) => has.has(key),
      // Adds to the end (newest last) or removes; returns the new state.
      toggle(key) {
        const on = !has.has(key);
        list = on ? [...list, key] : list.filter(k => k !== key);
        save();
        return on;
      },
      viewOn: false, // true while the header toggle shows favorites
    };

    window.refreshCards = () => {
      if (!window.assetsData || typeof createAssetCards !== "function") return [];
      const savedY    = window.scrollY;
      const promises  = createAssetCards(window.assetsData);
      if (typeof renderPage === "function") renderPage();
      if (typeof window.startPlaceholderCycle === "function") window.startPlaceholderCycle();
      Promise.all(promises.map(p => p.promise ?? p).filter(Boolean))
        .finally(() => window.scrollTo({ top: savedY, behavior: "instant" }));
      return promises;
    };
  }

  const _gifDurationCache = new Map();

  const _getLoadedGifUrl = () => getThemeGifSrc(_getTheme(), "loaded");

  function parseGifDuration(buf) {
    const b = new Uint8Array(buf);
    let ms = 0, i = 13;
    if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 0x07) + 1));
    while (i < b.length) {
      const block = b[i];
      if (block === 0x3B) break;
      if (block === 0x2C) {
        i += 10;
        if (b[i - 1] & 0x80) i += 3 * (1 << ((b[i - 1] & 0x07) + 1));
        i++;
        while (i < b.length) { const len = b[i++]; if (!len) break; i += len; }
      } else if (block === 0x21) {
        if (b[i + 1] === 0xF9) ms += (b[i + 4] | (b[i + 5] << 8)) * 10;
        i += 2;
        while (i < b.length) { const len = b[i++]; if (!len) break; i += len; }
      } else { i++; }
    }
    return ms > 0 ? ms : 2000;
  }

  function getLoadedGifDuration() {
    const url = _getLoadedGifUrl();
    if (_gifDurationCache.has(url)) return Promise.resolve(_gifDurationCache.get(url));
    return fetch(url)
      .then(r => { if (!r.ok) throw new Error("fetch failed"); return r.arrayBuffer(); })
      .then(buf => {
        const ms = parseGifDuration(buf);
        _gifDurationCache.set(url, ms);
        return ms;
      });
  }

  function getGifDuration(url) {
    if (_gifDurationCache.has(url)) return Promise.resolve(_gifDurationCache.get(url));
    return fetch(url)
      .then(r => { if (!r.ok) throw new Error("fetch failed"); return r.arrayBuffer(); })
      .then(buf => {
        const ms = parseGifDuration(buf);
        _gifDurationCache.set(url, ms);
        return ms;
      });
  }

  window._loaderSequenceRunning = false;

  function _getTheme() {
    return document.documentElement.getAttribute("theme") || DEFAULT_THEME;
  }

  function runLoaderSequence() {
    if (window._loaderSequenceRunning) return;
    const loader = document.getElementById("containerLoader");
    if (!loader) return;
    window._loaderSequenceRunning = true;

    const finish = () => { loader.remove(); document.body.classList.remove("ws-loading"); };

    const img = loader.querySelector("img");
    if (!img) { finish(); return; }

    getLoadedGifDuration()
      .then(ms => {

        applyGifToImg(img, _getTheme(), "loaded");
        setTimeout(finish, ms);
      })
      .catch(() => {
        applyGifToImg(img, _getTheme(), "loaded");
        setTimeout(finish, 2000);
      });
  }

  function runCrashSequence() {
    if (window._loaderSequenceRunning) return;
    const loader = document.getElementById("containerLoader");
    if (!loader) return;
    window._loaderSequenceRunning = true;

    const img = loader.querySelector("img");
    if (!img) return;

    document.body.classList.remove("ws-loading");

    const crashSrc = getThemeGifSrc(_getTheme(), "crash");
    getGifDuration(crashSrc)
      .catch(() => 2000)
      .then(ms => {
        applyGifToImg(img, _getTheme(), "crash");
        setTimeout(() => { applyGifToImg(img, _getTheme(), "ded"); }, ms);
      });
  }

  function _dismissPageLoader(pageNum) {
    if (+window.currentPage !== pageNum) return;

    runLoaderSequence();
  }

  function buildEmbedShell(embedSrc, title, fav) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <link rel="icon" href="${fav}" crossorigin="anonymous" />
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    embed { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; border: none; display: block; }
    #refreshBtn {
      position: fixed; top: 8px; right: 8px; z-index: 9999;
      background: rgba(0,0,0,0.6); color: #fff; border: none;
      border-radius: 6px; padding: 4px 10px; font-family: monospace;
      font-size: 13px; cursor: pointer; opacity: 0.4; transition: opacity 0.2s;
    }
    #refreshBtn:hover { opacity: 1; }
  </style>
</head>
<body>
  <embed id="frame" src="${embedSrc}" />
  <button id="refreshBtn" title="Refresh"
    onclick="document.getElementById('frame').src=document.getElementById('frame').src">↺</button>
</body>
</html>`;
  }

  async function fetchAndOpenHTML(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const raw     = await res.text();
    const pageURL = URL.createObjectURL(
      new Blob([sanitizeHTML(raw)], { type: "text/html;charset=utf-8" })
    );
    window.open(pageURL, "_blank");
  }

  // ── Row preprocessing ────────────────────────────────────────────────
  // Everything the renderer, search, category menu and daily picks need is
  // derived ONCE per row right after the fetch (status/type stacks, trimmed
  // + lowercased strings, category columns), instead of being re-split and
  // re-normalized in several places on every render.
  const _assetMeta = new WeakMap();
  let   _linkIndex = new Map();
  let   _columns   = null;
  let   _rawAssets = null;   // the last fetched rows, so "keep version assets hidden" can rebuild without refetching

  const _FIELD_ALIASES = {
    category:    ["category", "categories", "cat"],
    subcategory: ["sub-category", "subcategory", "sub category", "subcat"],
  };
  const _normKey = (k) => String(k).toLowerCase().replace(/[\s_-]/g, "");

  // Works out which real sheet headers map to each logical field once per
  // fetch, so per-row lookups become plain property reads.
  function _resolveColumns(rows) {
    const keys = [], seen = new Set();
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      for (const k in r) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
    const cols = {};
    for (const field in _FIELD_ALIASES) {
      const wanted = new Set(_FIELD_ALIASES[field].map(_normKey));
      cols[field] = keys.filter((k) => wanted.has(_normKey(k)));
    }
    return cols;
  }

  const _firstFilled = (row, keys) => {
    for (const k of keys) {
      const v = row[k];
      if (v == null) continue;
      const str = String(v).trim();
      if (str) return str;
    }
    return "";
  };

  const _parseStack = (raw) => {
    const out = new Set();
    const str = safeStr(raw);
    if (!str) return out;
    for (const part of str.toLowerCase().split("|")) {
      const t = part.trim();
      if (t) out.add(t);
    }
    return out;
  };

  const _MOVE_TO_TYPE = ["shiny", "disco", "animated", "grail"];
  // type values (spaces, dashes and underscores ignored) that mark an
  // asset as early access: "early access", "early-access", "tester", …
  const _EARLY_ACCESS_TYPES = new Set(["earlyaccess", "tester", "testers"]);
  const _MERGE_WORDS = ["merge", "merged"];

  // ── Bundles ────────────────────────────────────────────────────────────
  // Version rows (beta, v2, copies…) share one card with the asset they
  // follow. In sheet order, a row marked merge joins the bundle of the row
  // before it; the bundle ends at the next row without merge:
  //
  //   Asset         ok        ← the bundle's card (its "head")
  //   Asset (beta)  ok|merge  ← version 2
  //   Asset v2      ok|merge  ← version 3
  //   Other asset   ok        ← not merged: a new card
  //
  // Shift+click the card to cycle versions. Returns [[row, …], …] in sheet
  // order; a merge row with nothing above it is just its own card.
  function _groupBundles(rows) {
    const groups = [];
    let cur = null;
    for (const row of rows) {
      if (cur && getAssetMeta(row).merged) cur.push(row);
      else { cur = [row]; groups.push(cur); }
    }
    return groups;
  }

  // ── Local icon folders ───────────────────────────────────────────────
  // Icons waiting to go up to the R2 bucket are staged at the repo root as
  // iconsN/<project>/icon.<ext> (icons3, icons4, …; git-ignored). When the
  // site runs locally and an asset's hosted image fails (not on the bucket
  // yet), the card shows those before the placeholder. No glow: those assets
  // are marked "soon" in the sheet instead. Never on the deployed site: no
  // pointless requests there.
  const _REPO_ROOT = new URL("../../", document.currentScript?.src || location.href);
  const _LOCAL_HOST = /^(localhost|0\.0\.0\.0|127(\.\d+){3}|\[?::1\]?|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|.+\.local)$/i;
  const _isLocalSite = () => location.protocol === "file:" || _LOCAL_HOST.test(location.hostname);
  const _ICON_FOLDERS = Array.from({ length: 20 }, (_, i) => `icons${i + 1}`);
  const _ICON_FILE = /^icon\.(png|jpe?g|webp|gif|avif)$/i;
  const _IMAGE_FILE = /\.(png|jpe?g|webp|gif|avif)$/i;
  const _normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // Names from a local server's directory listing (Live Server, python -m
  // http.server, …), or null where there's no listing (file://, plain hosts).
  async function _listing(url) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok || !/html/i.test(res.headers.get("content-type") || "")) return null;
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      return [...doc.querySelectorAll("a[href]")]
        .map((a) => decodeURIComponent(a.getAttribute("href").split(/[?#]/)[0]).replace(/\/+$/, "").split("/").pop())
        .filter((n) => n && n !== "..");
    } catch (_) { return null; }
  }

  // Built once: normalized project name → [project folder URL, …], icons1
  // first. null = no listings, so _localIconCandidates guesses paths instead.
  let _localIconIndex;
  function _getLocalIconIndex() {
    if (_localIconIndex) return _localIconIndex;
    _localIconIndex = Promise.all(_ICON_FOLDERS.map(async (f) => [f, await _listing(new URL(`${f}/`, _REPO_ROOT).href)]))
      .then((found) => {
        const index = new Map();
        let any = false;
        for (const [f, names] of found) {
          if (!names) continue;
          any = true;
          for (const n of names) {
            const k = _normName(n);
            if (!k || _IMAGE_FILE.test(n)) continue;
            if (!index.has(k)) index.set(k, []);
            index.get(k).push(new URL(`${f}/${encodeURIComponent(n)}/`, _REPO_ROOT).href);
          }
        }
        return any ? index : null;
      });
    return _localIconIndex;
  }

  // The project names an asset could be staged under: its link's folder, its
  // image URL's folder (…/<name>/icon.png) and its title, as typed.
  function _iconNames(m, link) {
    const seg = (url, re) => (String(url || "").match(re) || [])[1] || "";
    const fromLink  = seg(link, /\/([^\/?#]+)\/(?:index\.html?)?(?:[?#].*)?$/i) || seg(link, /\/([^\/?#]+?)(?:\.html?(?:\.txt)?)?(?:[?#].*)?$/i);
    const fromImage = seg(m.imageTrim, /\/([^\/?#]+)\/[^\/?#]+\.(?:png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i);
    const fromTitle = m.titleLC.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return [...new Set([fromLink, fromImage, fromTitle].map((n) => decodeURIComponent(n)).filter(Boolean))];
  }

  // Local icon URLs to try for an asset, best first ([] off the local site).
  async function _localIconCandidates(m, link) {
    if (!_isLocalSite()) return [];
    const names = _iconNames(m, link);
    const index = await _getLocalIconIndex();
    if (index) {
      const out = [];
      for (const dir of [...new Set(names.flatMap((n) => index.get(_normName(n)) || []))]) {
        const files = await _listing(dir);
        const pick = files && (files.find((f) => _ICON_FILE.test(f)) || files.find((f) => _IMAGE_FILE.test(f)));
        if (pick) out.push(dir + encodeURIComponent(pick));
        else if (!files) out.push(...["png", "jpg", "jpeg", "webp", "gif"].map((e) => `${dir}icon.${e}`));
      }
      return out;
    }
    // No listings: guess the usual spots (icons3 onward, as typed and without
    // dashes, png/jpg). Only reached locally, and only for a failed image.
    const variants = [...new Set(names.flatMap((n) => [n, n.replace(/-/g, "")]))];
    return _ICON_FOLDERS.slice(2, 9).flatMap((f) =>
      variants.flatMap((n) => ["png", "jpg"].map((e) => new URL(`${f}/${encodeURIComponent(n)}/icon.${e}`, _REPO_ROOT).href)));
  }

  // The version picked on each bundle, by the lead's link → the picked
  // version's link, so a reload opens on the version you last chose. Links,
  // not titles: versions of one asset often share a title ("Cave Story" and
  // its web port). _versionKey falls back to the title for a row without one.
  const _BUNDLE_PICK_KEY = "ws_bundle_pick";
  const _versionKey = (m) => m.linkTrim || m.titleLC;
  const _readPicks = () => {
    try { return JSON.parse(localStorage.getItem(_BUNDLE_PICK_KEY) || "{}") || {}; } catch (_) { return {}; }
  };
  const _savePick = (leadKey, versionKey) => {
    const picks = _readPicks();
    if (versionKey === leadKey) delete picks[leadKey]; else picks[leadKey] = versionKey;
    try { localStorage.setItem(_BUNDLE_PICK_KEY, JSON.stringify(picks)); } catch (_) {}
  };

  // Card classes that belong to one version, swapped with it.
  const _VERSION_CLASSES = ["fix", "soon", "cooked"];

  // Which way the decks lean (Settings → Bundles, paging.js): -1 = right
  // (the default), 1 = left. Every deck re-fits its poses when it changes.
  const _bundleTilt = () => (window.WS_BundleSettings?.get().tilt === "left" ? 1 : -1);
  let _hideVersionsWas = !!window.WS_BundleSettings?.get().hideVersions;
  document.addEventListener("ws:bundle-settings-changed", () => {
    const hide = !!window.WS_BundleSettings?.get().hideVersions;
    if (hide !== _hideVersionsWas) {
      // Rebuild from the rows already fetched (no refetch): versions appear
      // or disappear, and everything re-renders around them.
      _hideVersionsWas = hide;
      if (_rawAssets && typeof window.refreshCards === "function") {
        window.assetsData = prepareAssets(_rawAssets);
        window.refreshCards();
      }
      return;
    }
    for (const c of window._allCards || []) c._layoutDeck?.();
  });

  // How far a bundle card may draw past its own edge (see the CSS below).
  // 0 where overflow-clip-margin isn't supported: those keep the grid's
  // plain clipping and the deck fits inside the card instead.
  const _DECK_BLEED = typeof CSS !== "undefined" && CSS.supports?.("overflow-clip-margin", "1px") ? 12 : 0;

  // Back-card poses as [x px, angle deg] for a hand leaning left (mirrored
  // for right), at rest and while the card is hovered; slot 1 is the next
  // version up. These are the most the deck will spread: each is scaled
  // down to fit the room around the image (_fitPose).
  const _DECK_POSES = [
    { rest: [-13, -8],  hover: [-24, -12] },
    { rest: [13, 8],    hover: [24, 12] },
    { rest: [-22, -14], hover: [-36, -19] },
  ];

  // Largest version of a pose (same shape, scaled by s <= 1) whose rotated
  // card stays inside `room` around a W x H image: left/right/top past the
  // image, and bottom down to just above the title. The card turns about
  // 50% 90% (its transform-origin), and is lifted as needed so a tilted
  // corner never dips under the title. Returns { tf, s } (a CSS transform).
  function _fitPose([tx0, deg0], W, H, room, tilt) {
    const ox = W / 2, oy = 0.9 * H;
    const corners = [[-ox, -oy], [ox, -oy], [-ox, H - oy], [ox, H - oy]];
    for (let s = 1; s > 0.12; s -= 0.04) {
      const tx = tx0 * s * tilt, deg = deg0 * s * tilt, rad = deg * Math.PI / 180;
      const c = Math.cos(rad), n = Math.sin(rad);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of corners) {
        const px = ox + x * c - y * n + tx, py = oy + x * n + y * c;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px);
        minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      }
      if (minX < -room.l || maxX > W + room.r) continue;
      // Lift (negative y) just enough to clear the title, if the top allows.
      const ty = Math.min(0, H + room.b - maxY);
      if (minY + ty < -room.t) continue;
      return { tf: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${deg.toFixed(2)}deg)`, s };
    }
    return { tf: "none", s: 0 };   // no room at all: tucked straight behind
  }

  function _injectBundleCSS() {
    if (document.getElementById("__ws_bundle_css__")) return;
    const s = document.createElement("style");
    s.id = "__ws_bundle_css__";
    s.textContent = `
      .asset-card.asset-bundle { position: relative; }

      /* The deck: the other versions' images fanned out behind the front
         one like a hand of cards. Spans, not divs/imgs, so the grid's
         "#container div" / "div img" rules leave them alone. Placed over
         the front image's box by _makeBundle (--deck-x/y/w/h). */
      .asset-card.asset-bundle > .asset-link { position: relative; z-index: 1; }
      .asset-card .bundle-deck { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
      .asset-card .bundle-deck-card {
        position: absolute;
        left: var(--deck-x, 50%); top: var(--deck-y, 15px);
        width: var(--deck-w, 120px); height: var(--deck-h, 120px);
        border-radius: 14px;
        border: 2px solid rgba(255,255,255,0.28);
        background: rgba(0,0,0,0.45) center / contain no-repeat;
        box-shadow: 0 4px 10px rgba(0,0,0,0.45);
        filter: brightness(0.72) saturate(0.85);
        transform-origin: 50% 90%;
        transition: transform 0.25s cubic-bezier(.3,1.4,.5,1), filter 0.2s ease;
        /* The deck sits under the front image, so only the parts peeking
           out take clicks: click one to bring that version up. */
        pointer-events: auto;
        cursor: pointer;
      }
      /* Each back card's pose is measured to fit (_fitPose): --t at rest,
         --th while hovered, which spreads the hand to show what's in it. */
      .asset-card .bundle-deck-card { transform: var(--t, none); }
      .asset-card.asset-bundle:hover .bundle-deck-card { transform: var(--th, var(--t, none)); filter: brightness(0.85) saturate(1); }
      .asset-card .bundle-deck-card:hover { filter: brightness(1.05) saturate(1.1) !important; }

      /* Room for the fanned deck: the grid clips every card at its edge
         (#container div { overflow: hidden }). A bundle may draw a few px
         past it (_DECK_BLEED), and anything further is still clipped, so
         nothing spills into the next card. Grail cards already show their
         overflow (main.css) and keep that. Text stays clipped to the card
         as before. */
      @supports (overflow-clip-margin: 1px) {
        .asset-card.asset-bundle:not(:has(.has-grail)) { overflow: clip !important; overflow-clip-margin: 12px; }
      }
      .asset-card.asset-bundle > :is(h3, p) { max-width: 100%; overflow: hidden; }
      @media (prefers-reduced-motion: reduce) {
        .asset-card .bundle-deck-card { transition: none; }
      }
      /* A fix / soon / cooked card normally takes no clicks at all (main.css).
         On a bundle only that version's link and buttons are locked, so
         Shift+click can still move on to a working version. */
      .asset-card.ready.asset-bundle.soon,
      .asset-card.ready.asset-bundle.fix,
      .asset-card.ready.asset-bundle.cooked { pointer-events: auto; }
      .asset-card.asset-bundle:is(.soon, .fix, .cooked) :is(.asset-link, .card-actions) { pointer-events: none; }
    `;
    document.head.appendChild(s);
  }

  // Turns the lead's card into the bundle: every version's parts (image
  // link, title, author, buttons) are faces, and Shift+click on the card
  // slides to the next one. The lead card stays the one grid element, so
  // paging, search and favorites keep working on a single card; search
  // matches any version's title or author.
  function _makeBundle(card, versions) {
    _injectBundleCSS();
    const leadKey = _versionKey(versions[0].m);
    versions.forEach((v, i) => {
      v.classes = _VERSION_CLASSES.filter((c) => v.card.classList.contains(c));
      if (i) v.card._host = card;
      v.face[0].title += ` Shift+click the card to switch version (${i + 1}/${versions.length}).`;
    });

    card.classList.add("asset-bundle");
    card._versions = versions;
    card._favKeys  = versions.map((v) => v.m.titleLC);
    card._hay      = versions.map((v) => v.m.titleLC + " " + v.m.authorLC).join(" ");

    // Up to three versions peek out behind the front one, next-up first.
    const deck = document.createElement("span");
    deck.className = "bundle-deck";
    deck.setAttribute("aria-hidden", "true");
    const backs = Array.from({ length: Math.min(versions.length - 1, 3) }, (_, k) => {
      const s = document.createElement("span");
      s.className = `bundle-deck-card d${k + 1}`;
      return deck.appendChild(s);
    });
    card.prepend(deck);

    const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let cur = 0, busy = false;

    // Back card k holds the version k+1 places after the front one.
    const versionAt = (k) => (cur + 1 + k) % versions.length;
    // A back card shows the image its version actually loaded (a staged
    // local icon or the placeholder when the hosted one failed).
    const shownImage = (v) => {
      const im = v.face[0].querySelector("img.asset-img");
      return im && im.complete && im.naturalWidth ? im.currentSrc || im.src : v.m.image;
    };
    const paintDeck = () => {
      backs.forEach((s, k) => {
        const v = versions[versionAt(k)];
        s.style.backgroundImage = `url("${String(shownImage(v)).replace(/"/g, "%22")}")`;
        s.title = `Switch to "${v.m.title || "Untitled"}" (${versionAt(k) + 1}/${versions.length})`;
      });
    };
    // Lay the deck over the front image's box, then fit each back card's
    // rest and hover pose into the room around it. Offsets, not
    // getBoundingClientRect, so the card's hover scale / pop-in don't skew
    // it; a ResizeObserver re-runs it when the card first shows or the grid
    // size setting changes the image size, and a tilt change re-runs it too.
    let fits = [];
    const layoutDeck = () => {
      const [link, titleEl] = versions[cur].face;
      const w = link.querySelector(".asset-img-wrapper");
      if (!w || !w.offsetWidth) return;
      let x = 0, y = 0;
      for (let el = w; el && el !== card; el = el.offsetParent) { x += el.offsetLeft; y += el.offsetTop; }
      const W = w.offsetWidth, H = w.offsetHeight;
      deck.style.setProperty("--deck-x", `${x}px`);
      deck.style.setProperty("--deck-y", `${y}px`);
      deck.style.setProperty("--deck-w", `${W}px`);
      deck.style.setProperty("--deck-h", `${H}px`);
      const titleTop = titleEl?.offsetParent === card ? titleEl.offsetTop : y + H + 8;
      const room = {
        l: x + _DECK_BLEED,
        r: card.clientWidth - x - W + _DECK_BLEED,
        t: y + _DECK_BLEED,
        b: Math.max(0, titleTop - (y + H) - 2),
      };
      const tilt = _bundleTilt();
      fits = backs.map((s, k) => {
        const pose = _DECK_POSES[k];
        const rest = _fitPose(pose.rest, W, H, room, tilt);
        const hover = _fitPose(pose.hover, W, H, room, tilt);
        s.style.setProperty("--t", rest.tf);
        s.style.setProperty("--th", hover.tf);
        return { rest, hover };
      });
    };
    card._layoutDeck = layoutDeck;
    if (typeof ResizeObserver === "function") new ResizeObserver(layoutDeck).observe(card);
    paintDeck();
    versions.forEach((v) => v.face[0].querySelector("img.asset-img")?.addEventListener("load", paintDeck));

    // Shuffle: the front card is tossed away from the deck's lean (only as
    // far as the deck itself was allowed to spread), and the one coming up
    // is drawn from its back card's fitted pose, so it looks pulled out of
    // the hand.
    const toss = () => {
      const tilt = _bundleTilt(), s = fits[0]?.hover.s ?? 1;
      return [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: `translate(${(28 * s * tilt).toFixed(1)}px, 0) rotate(${(12 * s * tilt).toFixed(2)}deg) scale(0.88)` },
      ];
    };
    const draw = (k) => [
      { opacity: 0.55, transform: `${fits[k]?.rest.tf || fits[0]?.rest.tf || "none"} scale(0.94)` },
      { opacity: 1, transform: "none" },
    ];
    const FADE_OUT = [{ opacity: 1 }, { opacity: 0 }];
    const FADE_IN  = [{ opacity: 0 }, { opacity: 1 }];

    // A version coming up from the deck: a copy of its back card lifts out
    // of the hand, un-tilts and lands square on the front image's spot
    // (dropping the card frame as it lands), while the old front card tips
    // away into the deck. Versions not in the deck (bundles of 5+) are drawn
    // from d1's pose instead.
    const show = (i, animate) => {
      const from = versions[cur], to = versions[i];
      const k    = (i - cur - 1 + versions.length) % versions.length;   // its deck slot
      const back = backs[k];
      let fly = null, outs = [];

      const swap = () => {
        from.face.forEach((n) => n.remove());
        outs.forEach((an) => an?.cancel());   // they held the old face hidden
        deck.after(...to.face);
        _VERSION_CLASSES.forEach((c) => card.classList.toggle(c, to.classes.includes(c)));
        card.classList.toggle("ws-favorited", !!window.WS_Favorites?.has(to.m.titleLC));
        card._favKey = to.m.titleLC;
        cur = i;
        if (back) back.style.visibility = "";
        paintDeck();
        layoutDeck();
        if (animate) {
          if (!fly) to.face[0].animate?.(draw(k), { duration: 260, easing: "cubic-bezier(.3,1.3,.5,1)" });
          to.face.slice(1).forEach((n) => n.animate?.(FADE_IN, { duration: 180, easing: "ease-out" }));
        }
        fly?.remove();
        busy = false;
      };

      if (!animate || reduced()) { animate = false; swap(); return; }
      busy = true;

      const tossed = toss();
      outs = from.face.map((n, j) => n.animate?.(j ? FADE_OUT : tossed,
        { duration: j ? 140 : 260, easing: "ease-in", fill: "forwards" }));

      let flight = null;
      if (back && back.offsetWidth) {
        const cs = getComputedStyle(back);
        fly = back.cloneNode(false);
        fly.removeAttribute("title");
        Object.assign(fly.style, {
          left: cs.left, top: cs.top, width: cs.width, height: cs.height,
          zIndex: "3", pointerEvents: "none", transition: "none",
        });
        card.appendChild(fly);
        back.style.visibility = "hidden";
        flight = fly.animate([
          { transform: cs.transform, filter: cs.filter, offset: 0 },
          { transform: "translateY(-10px) rotate(0deg) scale(1.06)", filter: "none", offset: 0.6 },
          { transform: "none", filter: "none", borderColor: "transparent",
            backgroundColor: "transparent", boxShadow: "none", offset: 1 },
        ], { duration: 340, easing: "cubic-bezier(.3,1.1,.5,1)", fill: "forwards" }).finished;
      }

      Promise.all([...outs.map((an) => an?.finished), flight]).then(swap, swap);
    };

    // Capture phase, so the card's own link never opens on a Shift+click.
    // The buttons row keeps its clicks, and the title keeps Shift+click to
    // copy it.
    const goTo = (i) => {
      if (busy || i === cur) return;
      show(i, true);
      _savePick(leadKey, _versionKey(versions[i].m));
    };
    card.addEventListener("click", (e) => {
      if (!e.shiftKey) return;
      if (e.target.closest(".card-actions, h3")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      goTo((cur + 1) % versions.length);
    }, true);
    // A plain click on a peeking back card brings that version up.
    backs.forEach((s, k) => s.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      goTo(versionAt(k));
    }));

    const picked = versions.findIndex((v) => _versionKey(v.m) === _readPicks()[leadKey]);
    if (picked > 0) show(picked, false);
  }

  function _buildMeta(row, cols) {
    const statusRaw = safeStr(row.status).toLowerCase();
    const statusSet = _parseStack(row.status);
    const typeSet   = _parseStack(row.type);
    const hidden    = statusRaw === "hide" || statusRaw === "hidden"
                   || statusSet.has("ignore") || typeSet.has("ignore");

    for (const t of _MOVE_TO_TYPE) {
      if (statusSet.has(t)) { typeSet.add(t); statusSet.delete(t); }
    }
    if (typeSet.has("cooked")) { statusSet.add("cooked"); typeSet.delete("cooked"); }
    // Bundles: "merge" / "merged" in status (ok|merge) or type makes this
    // row another version of the asset above it (see _groupBundles). Taken
    // out of the stacks so nothing else reads it as a status or badge.
    let merged = false;
    for (const t of _MERGE_WORDS) {
      if (statusSet.delete(t)) merged = true;
      if (typeSet.delete(t))   merged = true;
    }
    // Early access / tester builds: kept off the main grid and daily picks,
    // listed on the credits page instead (see _noteEarlyAccess).
    const earlyAccess = [...typeSet].some((t) => _EARLY_ACCESS_TYPES.has(t.replace(/[\s_-]+/g, "")));

    const title   = safeStr(row.title).trim();
    const author  = safeStr(row.author).trim();
    // Fixes bare-domain links (no "https://") from sheet data entry before
    // they're used anywhere — see normalizeExternalLink in utils.js.
    const rawLink = normalizeExternalLink(row.link);
    const rawImg  = safeStr(row.image).trim();
    const cat     = _firstFilled(row, cols.category);
    const sub     = _firstFilled(row, cols.subcategory);

    return {
      title, author,
      titleLC:     title.toLowerCase(),
      authorLC:    author.toLowerCase(),
      link:        rawLink || config.fallbackLink,
      linkTrim:    rawLink.trim(),
      image:       rawImg || config.fallbackImage,
      imageTrim:   rawImg,
      page:        Number(row.page) || 1,
      statusSet, typeSet, hidden, earlyAccess, merged,
      categoryRaw: cat,
      subcategoryRaw: sub,
      category:    cat.toLowerCase(),
      subcategory: sub.toLowerCase(),
      description: safeStr(row.description).trim(),
      animated:    safeStr(row.animated).trim(),
    };
  }

  function getAssetMeta(row) {
    let m = _assetMeta.get(row);
    if (!m) {
      // Row that didn't come through prepareAssets (e.g. assetsData swapped
      // in by another script) — build it lazily and cache it.
      m = _buildMeta(row, _columns || _resolveColumns([row]));
      _assetMeta.set(row, m);
    }
    return m;
  }

  function prepareAssets(raw) {
    _columns = _resolveColumns(raw);
    const rows      = [];
    const linkIndex = new Map();
    // Settings → Bundles → "Keep version assets hidden": version rows (status
    // ok|merge) are never built, so only the parent asset's card exists.
    const hideVersions = !!window.WS_BundleSettings?.get().hideVersions;
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const m = _buildMeta(row, _columns);
      if (!m.title && !m.linkTrim) continue;
      if (hideVersions && m.merged) continue;
      _assetMeta.set(row, m);
      if (m.linkTrim && !linkIndex.has(m.linkTrim)) linkIndex.set(m.linkTrim, m);
      rows.push(row);
    }
    _linkIndex = linkIndex;
    return rows;
  }

  // A sheet row flagged with this type (stacked in the "type" column
  // alongside/instead of others — see _parseStack) opens its own "link"
  // cell — same as any other asset, the sheet stays the source of truth —
  // but through openInBlankTab below instead of navigating the new tab
  // straight to that URL. "qwerty" is just a placeholder while this is
  // being tested from the sheet.
  const REALMZ_TYPE_TOKEN = "qwerty";

  // window.open() a blank tab, then append an <iframe src="url"> to it, so
  // the opened tab's own address bar stays on about:blank.
  function openInBlankTab(url) {
    const tab = window.open();
    if (!tab) return false;
    tab.document.body.style.margin   = "0";
    tab.document.body.style.padding  = "0";
    tab.document.body.style.overflow = "hidden";
    const iframe = tab.document.createElement("iframe");
    iframe.style.width  = "100vw";
    iframe.style.height = "100vh";
    iframe.style.border = "none";
    iframe.src = url;
    tab.document.body.appendChild(iframe);
    return true;
  }

  // Shared "open this asset" behaviour — used by grid cards and the daily
  // picks, so both honour the incognito modes and the html/txt loader.
  async function openAsset(link) {
    link = safeStr(link);
    const incognitoMode = localStorage.getItem("incognitoMode") || "off";
    const matched       = _linkIndex.get(link.trim());
    const resolvedLink  = matched ? matched.linkTrim : link;
    const renderTitle   = matched ? matched.title || "Embed" : "Embed";
    const renderFav     = matched ? matched.imageTrim : "";

    if (matched?.typeSet?.has(REALMZ_TYPE_TOKEN)) {
      openInBlankTab(resolvedLink);
      return;
    }

    if (
      /^https:\/\/cdn\.jsdelivr\.net\/.+\.html$/i.test(resolvedLink) ||
      /\.html\.txt$|\.txt$/.test(resolvedLink)
    ) {
      try { await fetchAndOpenHTML(resolvedLink); }
      catch (err) { console.error("[html/txt loader] fetch failed:", err); }
      return;
    }

    if (incognitoMode === "blob" && matched) {
      window.open(
        URL.createObjectURL(
          new Blob([buildEmbedShell(resolvedLink, renderTitle, renderFav)], { type: "text/html;charset=utf-8" })
        ), "_blank"
      );
    } else if (incognitoMode === "about" && matched) {
      const tab = window.open("about:blank", "_blank");
      if (tab) { tab.document.open("text/html", "replace"); tab.document.write(buildEmbedShell(resolvedLink, renderTitle, renderFav)); tab.document.close(); }
    } else {
      window.open(resolvedLink, "_blank");
    }
  }

  window.WS_getAssetMeta = getAssetMeta;
  window.WS_openAsset    = openAsset;

  (function injectIgnoreGuardCSS() {
    if (document.getElementById("__ws_ignore_guard__")) return;
    const s = document.createElement("style");
    s.id = "__ws_ignore_guard__";
    s.textContent = [
      `.asset-card[data-ignore="true"]{display:none!important;opacity:0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;pointer-events:none!important;overflow:hidden!important;}`,
    ].join("");
    document.head.appendChild(s);
  })();

  (function injectContainerAliasCSS() {
    if (document.getElementById("__ws_container_alias__")) return;
    const s = document.createElement("style");
    s.id = "__ws_container_alias__";
    s.textContent = `
      /* Grid layout — mirrors #container in main.css */
      #favorites-container,
      #dev-build-container {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        justify-items: center;
        gap: 15px;
        padding: 20px;
        background: transparent;
        flex-grow: 1;
        min-height: 0;
        align-content: start;
      }
      @media (max-width: 800px) {
        #favorites-container,
        #dev-build-container {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      /* Card div — mirrors #container div */
      #favorites-container div,
      #dev-build-container div {
        width: 100%;
        max-width: 220px;
        padding: 15px 10px;
        background: none;
        text-align: center;
        border-radius: 20px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        transition: transform 0.2s ease;
      }
      #favorites-container div:hover,
      #dev-build-container div:hover {
        transform: scale(1.03);
      }

      /* Card images — mirrors #container div img */
      #favorites-container div img,
      #dev-build-container div img {
        width: 120px;
        height: 120px;
        display: block;
        border-radius: 14px;
        object-fit: contain;
        transition: transform 0.3s ease;
      }
      #favorites-container div img:hover,
      #dev-build-container div img:hover {
        transform: scale(1.05);
      }

      /* Card text — mirrors #container div h3 / p */
      #favorites-container div h3,
      #favorites-container div p,
      #dev-build-container div h3,
      #dev-build-container div p {
        color: var(--url-color);
        font-family: monospace;
        font-size: 0.9rem;
        transition: color 0.3s, text-decoration 0.3s;
      }
      #favorites-container div h3:hover,
      #favorites-container div p:hover,
      #dev-build-container div h3:hover,
      #dev-build-container div p:hover {
        color: var(--accent-color);
        text-decoration: underline;
      }
    `;
    document.head.appendChild(s);
  })();

  (function injectAssetActionStyles() {
    if (document.getElementById("__ws_asset_actions__")) return;

    if (!document.querySelector("link[href*='font-awesome']")) {
      const fa = document.createElement("link");
      fa.rel  = "stylesheet";
      fa.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css";
      document.head.appendChild(fa);
    }

    const s = document.createElement("style");
    s.id = "__ws_asset_actions__";
    s.textContent = `
      .card-actions {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 2px;
        margin-top: 4px;
        padding: 0 2px;
        line-height: 1;
        width: 100%;
      }
      .favorite-star {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 2px 3px;
        font-size: 16px;
        line-height: 1;
        color: inherit;
        flex-shrink: 0;
        transition: transform 0.15s ease;
      }
      .asset-download-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 2px 3px;
        font-size: 14px;
        line-height: 1;
        color: inherit;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        transition: transform 0.15s ease;
      }
      .asset-download-btn .fa { pointer-events: none; }
      .asset-action-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 2px 3px;
        font-size: 14px;
        line-height: 1;
        color: var(--trench-color, #000) !important;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        transition: transform 0.15s ease;
      }
      .asset-action-btn i { pointer-events: none; }

      /* The trench (the row of buttons under each card) sits right on the
         theme's background: a thin dark outline keeps the theme's
         --trench-color readable over light and busy patches alike. */
      .card-actions .favorite-star,
      .card-actions .asset-download-btn,
      .card-actions .asset-action-btn {
        filter: drop-shadow(0 0 0.6px rgba(0, 0, 0, 0.7));
      }

      /* Each button grows on its own hover — the card itself no longer
         scales while the cursor is anywhere over this row (see main.css). */
      .card-actions .favorite-star:hover,
      .card-actions .asset-download-btn:hover,
      .card-actions .asset-action-btn:hover {
        transform: scale(1.3);
      }

      /* Description card: slides in from the left, styled like the daily
         picks pop-up (accent border, offset accent shadow, slight tilt). */
      .description-panel {
        position: fixed;
        left: -380px;
        top: 85%;
        transform: translateY(-50%) rotate(-1.5deg);
        width: 320px;
        max-width: calc(100vw - 40px);
        transition: left .4s cubic-bezier(.3, 1.4, .5, 1);
        z-index: 999999;
        pointer-events: none;
        padding: 14px 16px 16px;
        border-radius: 20px 16px 22px 14px;
        border: 3px solid var(--accent-color, #f44);
        background: var(--aside-bg, rgba(0,0,0,0.92));
        box-shadow: 7px 7px 0 var(--accent-color, #f44);
        color: var(--url-color, #fff);
      }
      .description-panel.desc-visible {
        left: 20px;
        pointer-events: all;
      }
      .description-panel :not(i) { font-family: monospace; }
      .description-panel .desc-head {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 10px;
        padding-bottom: 10px;
        border-bottom: 2px dashed rgba(255,255,255,0.2);
      }
      .description-panel .desc-head img {
        flex: none;
        width: 44px;
        height: 44px;
        border-radius: 12px;
        border: 2px solid var(--accent-color, #f44);
        object-fit: cover;
        background: rgba(0,0,0,0.4);
        transform: rotate(-6deg);
        box-shadow: 3px 3px 0 rgba(0,0,0,0.5);
      }
      .description-panel .desc-title {
        display: block;
        font-weight: bold;
        font-size: 14px;
        line-height: 1.25;
        text-shadow: 2px 2px 0 var(--accent-color, #f44);
        overflow-wrap: anywhere;
      }
      .description-panel .desc-author { display: block; margin-top: 3px; font-size: 11px; opacity: 0.7; }
      .description-panel .alert-text {
        text-align: left;
        white-space: normal;
        overflow-wrap: anywhere;
        line-height: 1.55;
        font-size: 13px;
        max-height: 40vh;
        overflow-y: auto;
      }
      .description-panel .alert-text.is-empty { opacity: 0.65; font-style: italic; }
      @media (prefers-reduced-motion: reduce) {
        .description-panel { transition: none; }
      }
    `;
    document.head.appendChild(s);
  })();

  // Styled hover labels for the header, the ☰ menu, the footer and each
  // card's button row (the "trench"): an element's title shows in a black
  // bubble pointing at it (.ws-tip in main.css), above it or below it when
  // there's no room above. While shown, the title is parked in data-tip so
  // the browser's own plain tooltip stays away, then put back on the way
  // out (other code finds elements by their title, e.g. the tour's
  // [title='Coming soon']). A title changed by a click (☆, favorites
  // toggle) is picked up on the spot. Keyboard focus shows it too.
  (function initTrenchTips() {
    const SEL  = ["#topBar", "#dashboardMenu", "footer", ".card-actions"]
      .map((scope) => `${scope} [title], ${scope} [data-tip]`).join(", ");
    const GAP  = 10;   // bubble ↔ button
    const EDGE = 8;    // bubble ↔ screen edge
    let tip = null, current = null;

    const ensureTip = () => {
      if (tip) return tip;
      tip = document.createElement("div");
      tip.className = "ws-tip";
      tip.id = "wsTip";
      tip.setAttribute("role", "tooltip");
      document.body.appendChild(tip);
      return tip;
    };

    // Parks the title (a fresh one wins over an older parked copy).
    const tipText = (el) => {
      const t = el.getAttribute("title");
      if (t) {
        el.dataset.tip = t;
        el.removeAttribute("title");
      }
      return el.dataset.tip || "";
    };
    const restoreTitle = (el) => {
      if (el && el.dataset.tip && !el.hasAttribute("title")) el.setAttribute("title", el.dataset.tip);
    };

    function place(el) {
      const text = tipText(el);
      if (!text || !el.isConnected) { hide(); return; }
      const t = ensureTip();
      t.textContent = text;
      t.style.left = "0px";
      t.style.top  = "0px";
      const r  = el.getBoundingClientRect();
      const w  = t.offsetWidth, h = t.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const cx = r.left + r.width / 2;
      const left  = Math.max(EDGE, Math.min(cx - w / 2, vw - w - EDGE));
      const above = r.top - h - GAP >= EDGE;
      t.dataset.side = above ? "top" : "bottom";
      t.style.left = `${left}px`;
      t.style.top  = `${above ? r.top - h - GAP : r.bottom + GAP}px`;
      t.style.setProperty("--arrow-x", `${Math.max(10, Math.min(cx - left, w - 10))}px`);
      el.setAttribute("aria-describedby", "wsTip");
      requestAnimationFrame(() => t.classList.add("is-shown"));
    }

    function show(el) {
      if (current && current !== el) {
        current.removeAttribute("aria-describedby");
        restoreTitle(current);
      }
      current = el;
      tip?.classList.remove("is-shown");
      place(el);
    }

    function hide() {
      if (current) {
        current.removeAttribute("aria-describedby");
        restoreTitle(current);
      }
      current = null;
      tip?.classList.remove("is-shown");
    }

    document.addEventListener("mouseover", (e) => {
      const el = e.target.closest?.(SEL);
      if (el === current) return;
      if (el) show(el); else if (current) hide();
    });
    document.addEventListener("mouseout", (e) => { if (!e.relatedTarget) hide(); });
    document.addEventListener("focusin", (e) => {
      const el = e.target.closest?.(SEL);
      if (el) show(el);
    });
    document.addEventListener("focusout", (e) => { if (e.target === current) hide(); });
    // A click can change the label (☆ add/remove): re-read it once the
    // click's handlers have run.
    document.addEventListener("click", (e) => {
      if (!current || !current.contains(e.target)) return;
      setTimeout(() => { if (current) place(current); }, 0);
    });
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    window.addEventListener("blur", hide);
  })();

  (function injectAltContainerCSS() {
    if (document.getElementById("__ws_alt_containers__")) return;
    const s = document.createElement("style");
    s.id = "__ws_alt_containers__";
    s.textContent = `
      /* ── Grid layout (mirrors #container) ── */
      #favorites-container,
      #dev-build-container {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        justify-items: center;
        gap: 15px;
        padding: 20px;
        background: transparent;
        flex-grow: 1;
        min-height: 0;
        align-content: start;
      }

      @media (max-width: 800px) {
        #favorites-container,
        #dev-build-container {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      /* ── Card box (mirrors #container div) ── */
      #favorites-container div,
      #dev-build-container div {
        width: 100%;
        max-width: 220px;
        padding: 15px 10px;
        background: none;
        text-align: center;
        border-radius: 20px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        transition: transform 0.2s ease;
      }

      #favorites-container div:hover,
      #dev-build-container div:hover {
        transform: scale(1.03);
      }

      /* ── Card images ── */
      #favorites-container div img,
      #dev-build-container div img {
        width: 120px;
        height: 120px;
        display: block;
        border-radius: 14px;
        object-fit: contain;
        transition: transform 0.3s ease;
      }

      #favorites-container div img:hover,
      #dev-build-container div img:hover {
        transform: scale(1.05);
      }

      /* ── Card text ── */
      #favorites-container div h3,
      #favorites-container div p,
      #dev-build-container div h3,
      #dev-build-container div p {
        color: var(--url-color);
        font-family: monospace;
        font-size: 0.9rem;
        transition: color 0.3s, text-decoration 0.3s;
      }

      #favorites-container div h3:hover,
      #favorites-container div p:hover,
      #dev-build-container div h3:hover,
      #dev-build-container div p:hover {
        color: var(--accent-color);
        text-decoration: underline;
      }

      /* ── version-pending pointer block ── */
      #favorites-container.version-pending,
      #dev-build-container.version-pending {
        pointer-events: none;
      }

      /* ── Hide container while the loader GIF is active ── */
      body.ws-loading #favorites-container,
      body.ws-loading #dev-build-container {
        visibility: hidden;
        height: 0;
        min-height: 0;
        overflow: hidden;
        padding: 0;
        gap: 0;
      }
    `;
    document.head.appendChild(s);
  })();

  // Grid order for a set of cards (paging.js); page, then sheet row order,
  // if paging.js isn't on the page.
  const orderCards = (cards) => window.WS_Paging
    ? window.WS_Paging.orderCards(cards)
    : cards.slice().sort((a, b) => a._page - b._page || a._idx - b._idx);

  // _cardIndex: view page → its cards. The view page is the sheet page,
  // except for paged A–Z across pages, where paging.js deals the A–Z order
  // back into the pages.
  function indexCardPages(cards) {
    if (window.WS_Paging) window.WS_Paging.assignViewPages(cards);
    else for (const c of cards) c._viewPage = c._page;
    window._cardIndex = new Map();
    for (const c of cards) {
      if (!window._cardIndex.has(c._viewPage)) window._cardIndex.set(c._viewPage, []);
      window._cardIndex.get(c._viewPage).push(c);
    }
  }

  function createAssetCards(data) {
    const { container } = dom || {};
    if (!container) return [];

    container.innerHTML = "";
    // Bug-report menus live on document.body (to escape #container's
    // overflow:hidden), so clearing #container above doesn't remove the
    // previous render's copies — do that here instead.
    document.querySelectorAll(".asset-bug-menu, .description-panel").forEach((el) => el.remove());
    window._openBugMenu = null;
    const imagePromises = [];
    const frag          = document.createDocumentFragment();
    const activePage    = +window.currentPage || +sessionStorage.getItem("currentPage") || 1;

    const isDevPage = window._containerMode === "dev";

    // Rebuilt from scratch every render (refreshCards re-renders too), so
    // the previous render's cards don't linger in the index.
    window._cardIndex = new Map();
    window._allCards  = [];

    // Cards are built in sheet order; their grid order (sheet / A–Z, per
    // page or across everything) comes from WS_Paging.orderCards below.
    // Each card is a bundle of one or more versions (_groupBundles); hidden
    // and early-access versions drop out, and the first one left leads.
    const shown = (asset) => {
      const m = getAssetMeta(asset);
      return !m.hidden && !m.earlyAccess;
    };
    const bundles = _groupBundles(Array.isArray(data) ? data : [])
      .map((group) => group.filter(shown))
      .filter((group) => group.length);
    const builtCards = [];
    // A version card that isn't showing lives outside the grid; its buttons
    // act on the bundle's card instead (_host).
    const hostOf = (c) => c._host || c;

    const badgeMap = {
      featured: "https://raw.githubusercontent.com/01110010-00110101/01110010-00110101.github.io/main/system/images/featured-cover.png",
      new:      "https://raw.githubusercontent.com/01110010-00110101/01110010-00110101.github.io/main/system/images/new-cover.png",
      fixed:    "https://raw.githubusercontent.com/01110010-00110101/01110010-00110101.github.io/main/system/images/fixed-cover.png",
      fix:      "https://raw.githubusercontent.com/01110010-00110101/01110010-00110101.github.io/main/system/images/fixing.png",
    };

    const BUG_REASONS = ["Blocked", "404/Missing", "Missing Icon", "Buffer/Loading Error"];
    const BUG_ICONS = {
      "Blocked":              "fa-ban",
      "404/Missing":          "fa-link-slash",
      "Missing Icon":         "fa-image",
      "Buffer/Loading Error": "fa-hourglass-half",
    };
    const PADLET_URL  = "https://padlet.com/ankomstudios/breakout-room/x1rD2JLb7VXPv0dM-B8nYzL821Wo3zV4L";

    const addOverlay = (wrapper, src, alt, cls, fullCover = false) => {
      const o = document.createElement("img");
      o.src = src; o.alt = alt; o.className = `status-overlay ${cls}`;
      Object.assign(o.style, {
        position: "absolute", top: "0", left: "0",
        width: "100%", height: "100%", objectFit: "cover",
        pointerEvents: "none", zIndex: fullCover ? "10" : "5",
      });
      wrapper.appendChild(o);
    };

    if (!window._bugMenuGlobalHandlerBound) {
      window._bugMenuGlobalHandlerBound = true;
      document.addEventListener("click", (e) => {
        const openMenu = window._openBugMenu;
        if (!openMenu) return;
        if (openMenu.contains(e.target) || e.target.closest(".asset-bug-btn") === openMenu._bugBtn) return;
        openMenu.style.display = "none";
        openMenu.setAttribute("aria-hidden", "true");
        if (openMenu._bugBtn) openMenu._bugBtn.setAttribute("aria-expanded", "false");
        window._openBugMenu = null;
      });
    }

    if (!window._bugReportModalBuilt) {
      window._bugReportModalBuilt = true;

      const BUG_REPORT_TERMS = {
        "Blocked": [
          "I understand “Blocked” means the asset refuses to load or shows an access-denied message.",
          "I've confirmed this happens on a fresh page reload, not just once.",
          "I'm not filing this to grief, spam, or troll the report queue.",
        ],
        "404/Missing": [
          "I confirm the linked page or file returns a 404 or otherwise can't be found.",
          "I've waited for the page to load and this isn't just a slow connection.",
          "I'm not filing this to grief, spam, or troll the report queue.",
        ],
        "Missing Icon": [
          "I confirm the card's icon/thumbnail is blank or broken, not just still loading.",
          "I've reloaded the page and the icon is still missing.",
          "I'm not filing this to grief, spam, or troll the report queue.",
        ],
        "Buffer/Loading Error": [
          "I confirm the asset gets stuck buffering/loading and never finishes.",
          "I've waited a reasonable amount of time and tried reloading.",
          "I'm not filing this to grief, spam, or troll the report queue.",
        ],
      };

      const overlay = document.createElement("div");
      overlay.className = "bug-report-overlay";

      const modal = document.createElement("div");
      modal.className = "bug-report-modal";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "bugReportQuestion");
      modal.innerHTML = `
        <button type="button" class="bug-report-close" id="bugReportClose" aria-label="Close">✕</button>
        <img id="bugReportImg" alt="" />
        <h3 id="bugReportTitle"></h3>
        <p class="bug-report-author" id="bugReportAuthor"></p>
        <p class="bug-report-question" id="bugReportQuestion"></p>
        <ul class="bug-report-terms" id="bugReportTerms"></ul>
        <div class="bug-report-throbber" id="bugReportThrobber">
          <span class="bug-report-spinner"></span>
          <span>Submitting report&hellip;</span>
        </div>
        <div class="bug-report-actions" id="bugReportActions">
          <button type="button" id="bugReportDiscard">Discard</button>
          <button type="button" id="bugReportAgree" class="bug-report-agree">Agree to terms</button>
        </div>
      `;
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const imgEl      = modal.querySelector("#bugReportImg");
      const titleEl2   = modal.querySelector("#bugReportTitle");
      const authorEl2  = modal.querySelector("#bugReportAuthor");
      const questionEl = modal.querySelector("#bugReportQuestion");
      const termsEl    = modal.querySelector("#bugReportTerms");
      const throbberEl = modal.querySelector("#bugReportThrobber");
      const actionsEl  = modal.querySelector("#bugReportActions");
      const discardBtn = modal.querySelector("#bugReportDiscard");
      const agreeBtn   = modal.querySelector("#bugReportAgree");

      const resetModalUI = () => {
        modal.classList.remove("closing");
        throbberEl.classList.remove("visible");
        actionsEl.style.display = "flex";
        discardBtn.disabled = false;
        agreeBtn.disabled   = false;
      };

      const closeModal = () => {
        overlay.classList.remove("visible");
        setTimeout(() => { overlay.style.display = "none"; resetModalUI(); }, 250);
      };

      // Closable (backdrop, ✕, Discard, Esc) until a report is submitting.
      const canClose = () => !discardBtn.disabled;
      overlay.addEventListener("click", (e) => { if (e.target === overlay && canClose()) closeModal(); });
      discardBtn.addEventListener("click", closeModal);
      modal.querySelector("#bugReportClose").addEventListener("click", () => { if (canClose()) closeModal(); });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && overlay.classList.contains("visible") && canClose()) {
          e.preventDefault(); e.stopPropagation();
          closeModal();
        }
      }, true);

      agreeBtn.addEventListener("click", () => {
        discardBtn.disabled = true;
        agreeBtn.disabled   = true;
        throbberEl.classList.add("visible");

        // Placeholder: no report is actually sent/logged yet, pending the
        // Apps Script report-collection endpoint. Just simulate a submit
        // delay, then play the dismiss animation.
        setTimeout(() => {
          modal.classList.add("closing");
          overlay.classList.remove("visible");
          setTimeout(() => { overlay.style.display = "none"; resetModalUI(); }, 400);
        }, 1200);
      });

      window._openBugReportModal = ({ title, author, image, reason }) => {
        imgEl.src              = image || "";
        imgEl.alt              = title || "";
        titleEl2.textContent   = title || "Untitled";
        authorEl2.textContent  = author || "";
        questionEl.textContent = `Report "${title || "this asset"}" for ${reason}?`;

        termsEl.innerHTML = "";
        (BUG_REPORT_TERMS[reason] || []).forEach((term) => {
          const li = document.createElement("li");
          li.textContent = term;
          termsEl.appendChild(li);
        });

        resetModalUI();
        overlay.style.display = "flex";
        requestAnimationFrame(() => overlay.classList.add("visible"));
        agreeBtn.focus({ preventScroll: true });
      };
    }

    // One version's card. `primary` is the bundle's lead: only it goes in
    // the grid and holds up the page loader; the others are faces the lead
    // swaps in (_makeBundle).
    const buildCard = (asset, primary) => {
      // All parsing already happened in prepareAssets(); read-only from here
      // on (statusSet/typeSet are shared with the meta cache, never mutate).
      const m          = getAssetMeta(asset);
      const title      = m.title;
      const author     = m.author;
      const imageSrc   = m.image;
      const link       = m.link;
      const statusSet  = m.statusSet;
      const typeSet    = m.typeSet;

      const pageNum    = m.page;
      const isActivePage = pageNum === activePage;
      const favKey     = m.titleLC;

      const card = document.createElement("div");
      card.className = "asset-card" + (window.WS_Favorites?.has(favKey) ? " ws-favorited" : "");
      card._favKey = favKey;
      // Sort keys for WS_Paging.orderCards (paging.js).
      card._page  = pageNum;
      card._idx   = builtCards.length;
      card._title = title;

      card.style.display = "none";
      Object.assign(card.dataset, {
        title:       m.titleLC,
        author:      m.authorLC,
        page:        String(pageNum),
        filtered:    "true",
        category:    m.category,
        subcategory: m.subcategory,
      });
      // Pre-joined search haystack — filterAssets reads this per keystroke
      // instead of rebuilding it from two dataset lookups per card.
      card._hay = m.titleLC + " " + m.authorLC;

      const a   = document.createElement("a");
      a.href    = link;
      a.className = "asset-link";
      a.title   = `Click to open "${title || "this asset"}" in a new tab!`;

      a.addEventListener("click", (e) => {
        e.preventDefault();
        openAsset(link);
      });

      const wrapper = document.createElement("div");
      wrapper.className = "asset-img-wrapper";
      Object.assign(wrapper.style, { position: "relative", display: "inline-block", borderRadius: "14px" });

      const img = document.createElement("img");
      img.alt           = title;
      img.className     = "asset-img";
      img.fetchPriority = isActivePage ? "high" : "auto";

      const imgPromise = new Promise((resolve) => {
        // Four tiers: the real hosted image; then, running locally, a staged
        // icon from iconsN/<project>/ at the repo root (not on the R2 bucket
        // yet, see _localIconCandidates); then a local .../<name>/icon.png
        // guess (useful while icons are still being imported port-by-port);
        // then the generic placeholder. The last two tiers count as "fallback
        // active" — flag them visually (image only, per the red-glow ask) so
        // it's obvious at a glance which cards have no icon anywhere. A staged
        // icon doesn't glow: it exists, just isn't uploaded yet.
        const hasRealImage  = !!m.imageTrim;
        // The ../<name>/icon.png guess only exists on a local checkout with
        // the asset folders beside the site. On the deployed site it was a
        // guaranteed 404 for every missing image (~540 dead requests per
        // load, competing with the real images), so it's local-only.
        const localFallback = _isLocalSite() ? localIconFallback(link) : "";
        let   watchdog;
        const clearWatchdog = () => clearTimeout(watchdog);
        const onLoad        = () => { clearWatchdog(); resolve(); };
        const markFallback  = () => img.classList.add("img-fallback");

        // Re-armed before every tier's img.src is set: a host that neither
        // loads nor errors within IMG_WAIT_MS is treated the same as a load
        // error (falls through to the next tier) instead of just resolving
        // the card "ready" with nothing actually rendered — a card only
        // counts as ready once some image has genuinely finished loading,
        // same as one with a real hosted image.
        const arm = (onStall) => { clearWatchdog(); watchdog = setTimeout(onStall, IMG_WAIT_MS); };

        const tryFinal = () => {
          markFallback();
          img.onload  = onLoad;
          // Nothing left to fall back to: a stall here still has to give up
          // eventually so it doesn't hold the whole page's loader hostage,
          // but only after this image itself got its full IMG_WAIT_MS try.
          img.onerror = onLoad;
          arm(onLoad);
          img.src = config.fallbackImage;
        };

        const tryLocal = () => {
          markFallback();
          if (localFallback) {
            img.onload  = onLoad;
            img.onerror = tryFinal;
            arm(tryFinal);
            img.src = localFallback;
          } else {
            tryFinal();
          }
        };

        // Each staged icon in turn; the first one that loads wins.
        const tryStaged = () => {
          _localIconCandidates(m, link).then((urls) => {
            const next = () => {
              const url = urls.shift();
              if (!url) { tryLocal(); return; }
              img.onload  = onLoad;
              img.onerror = next;
              arm(next);
              img.src = url;
            };
            next();
          }, tryLocal);
        };

        if (!hasRealImage) {
          tryStaged();
        } else {
          img.onload  = onLoad;
          img.onerror = tryStaged;
          arm(tryStaged);
          img.src = imageSrc;
        }
      });
      if (primary) imagePromises.push({ promise: imgPromise, page: pageNum, card });
      wrapper.appendChild(img);

      if (typeSet.has("featured")) addOverlay(wrapper, badgeMap.featured, "featured badge", "overlay-featured");
      if (typeSet.has("new"))      addOverlay(wrapper, badgeMap.new,      "new badge",      "overlay-new");
      if (typeSet.has("fixed"))    addOverlay(wrapper, badgeMap.fixed,    "fixed badge",    "overlay-fixed");

      if (typeSet.has("grail")) {
        const grailEl = document.createElement("img");
        grailEl.src = "assets/images/type-overlayStyles/grail.png";
        grailEl.alt = "";
        grailEl.className = "grail-bg";
        wrapper.insertBefore(grailEl, wrapper.firstChild);
        wrapper.classList.add("has-grail");
      }

      if (typeSet.has("disco"))     img.classList.add("img-disco");
      if (typeSet.has("shiny"))     wrapper.classList.add("img-shiny");
      if (typeSet.has("pixelated")) img.style.imageRendering = "pixelated";
      if (typeSet.has("cover")) {

        Object.assign(wrapper.style, {
          overflow: "hidden",
          maxHeight: "250px",
          height:    "250px",
          width:     "100%",
          display:   "block",
        });
        Object.assign(img.style, {
          width:      "100%",
          height:     "var(--asset-img-size, 120px)",
          objectFit:  "cover",

          objectPosition: "center top",
          display:    "block",
        });
      }

      if (statusSet.has("fix"))  { addOverlay(wrapper, badgeMap.fix, "fixing overlay", "overlay-fix", true); card.classList.add("fix"); }
      if (statusSet.has("soon"))   card.classList.add("soon");
      if (statusSet.has("cooked")) {
        const isDmca    = typeSet.has("dmca") || statusSet.has("dmca");
        const isBlocked = typeSet.has("blocked") || statusSet.has("blocked");
        if (isDmca || isBlocked) {
          img.src = "assets/images/placeholders/cooked.png";
          img.style.imageRendering = "pixelated";
        }
        card.classList.add("cooked");
      }

      const animatedSrc = m.animated;
      const animatedSwapAllowed = typeof window.WS_Grid?.animatedSwapEnabled === "function"
        ? window.WS_Grid.animatedSwapEnabled()
        : true;
      if (typeSet.has("animated") && animatedSrc && animatedSwapAllowed) {
        const isVideo = /\.(mp4|webm|ogg)([?]|$)/i.test(animatedSrc);
        let animEl = null, animTimeout = null, isAnimating = false;

        // Stops itself once the card has been removed by a re-render — no
        // per-card MutationObserver watching the whole document any more.
        const scheduleNext = () => {
          // Still being built (not in the grid yet) counts as alive; only a
          // card a later render dropped from _allCards stops here.
          const host = hostOf(card);
          if (!host.isConnected && host.parentNode !== frag && !window._allCards.includes(host)) return;
          animTimeout = setTimeout(playAnim, (3 + Math.random() * 57) * 1000);
        };
        const playAnim = () => {
          if (!hostOf(card).isConnected) { animEl?.remove(); return; }
          if (isAnimating) return;
          isAnimating = true;
          animEl = document.createElement(isVideo ? "video" : "img");
          animEl.src = animatedSrc;
          if (isVideo) Object.assign(animEl, { autoplay: true, muted: true, loop: false, playsInline: true });
          animEl.className = "animated-swap";
          wrapper.insertBefore(animEl, wrapper.firstChild);
          setTimeout(() => { animEl?.remove(); animEl = null; isAnimating = false; scheduleNext(); },
            (3 + Math.random() * 5) * 1000);
        };

        if (img.complete && img.naturalWidth) scheduleNext();
        else img.addEventListener("load", scheduleNext, { once: true });
      }

      a.appendChild(wrapper);
      const titleEl  = document.createElement("h3"); titleEl.textContent  = title  || "Untitled";
      const authorEl = document.createElement("p");  authorEl.textContent = author || "";

      titleEl.title = "Shift+click to copy title";
      titleEl.addEventListener("click", (e) => {
        if (!e.shiftKey) return;
        e.preventDefault(); e.stopPropagation();
        const text = title || "Untitled";
        navigator.clipboard?.writeText(text).then(() => {
          const original = titleEl.textContent;
          titleEl.textContent = "Copied!";
          setTimeout(() => { titleEl.textContent = original; }, 900);
        }).catch((err) => console.warn("[title-copy] clipboard write failed:", err));
      });

      if (statusSet.has("cooked")) {
        const isDmca    = typeSet.has("dmca") || statusSet.has("dmca");
        const isBlocked = typeSet.has("blocked") || statusSet.has("blocked");
        if (isDmca || isBlocked) {
          a.title              = isDmca ? "DMCA Takedown — unavailable" : "Blocked — unavailable";
          authorEl.textContent = isDmca ? "DMCA TAKEDOWN" : "BLOCKED D:";
        }
      }

      const star = document.createElement("button");
      star.className = "favorite-star";
      star.style.cssText = "background:transparent!important;border:none!important;cursor:pointer;padding:2px 3px!important;font-size:16px!important;line-height:1!important;color:var(--trench-color,#000)!important;display:inline-flex!important;align-items:center!important;";
      const paintStar = (on) => {
        star.innerHTML = `<i class="${on ? "fa-solid" : "fa-regular"} fa-star" aria-hidden="true"></i>`;
        star.title = on ? "Remove from favorites" : "Add to favorites";
        star.setAttribute("aria-pressed", String(on));
      };
      paintStar(window.WS_Favorites?.has(favKey));
      star.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        const on = window.WS_Favorites.toggle(favKey);
        paintStar(on);
        hostOf(card).classList.toggle("ws-favorited", on);
        // In the favorites view this re-flows the favorites pages (an
        // unfavorited card drops out); in the main view nothing moves.
        if (window.WS_Favorites.viewOn) window.filterAssets?.(dom.searchInput?.value || "");
      });

      const dlBtn = document.createElement("button");
      dlBtn.className = "asset-download-btn";
      dlBtn.title     = `Download "${title || "asset"}" as HTML`;
      dlBtn.innerHTML = `<i class="fa-solid fa-download" aria-hidden="true"></i>`;
      dlBtn.style.cssText = "background:transparent!important;border:none!important;cursor:pointer;padding:2px 3px!important;font-size:14px!important;line-height:1!important;color:var(--trench-color,#000)!important;display:inline-flex!important;align-items:center!important;";
      dlBtn.addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation();
        try {
          const assetTitle = title    || "Untitled";
          const assetUrl   = link     || "";
          const assetFav   = imageSrc || "";

          let favIconBase64 = "";
          try {
            const imgRes  = await fetch(assetFav, { mode: "cors" });
            const imgBlob = await imgRes.blob();
            favIconBase64 = await new Promise((res) => {
              const reader  = new FileReader();
              reader.onload = () => res(reader.result);
              reader.readAsDataURL(imgBlob);
            });
          } catch (_) {  }

          const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${assetTitle}</title>
  <link rel="icon" type="image/png" href="${favIconBase64}" />
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    embed {
      position: absolute;
      top: 0; left: 0;
      width: 100vw;
      height: 100vh;
      border: none;
      display: block;
    }
  </style>
</head>
<body>
  <embed id="frame" src="${assetUrl}" />
</body>
</html>`;

          const safeFilename = assetTitle.replace(/[^a-z0-9_\-\. ]/gi, "_").trim() || "asset";
          const blob   = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
          const blobUrl = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href     = blobUrl;
          anchor.download = `${safeFilename}.html`;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        } catch (err) {
          console.error("[asset-download] failed:", err);
        }
      });

      const descText = m.description;
      const descMsg  = descText || `No description available for "${title || "this asset"}".`;

      const descBtn = document.createElement("button");
      descBtn.className = "asset-action-btn asset-desc-btn";
      descBtn.innerHTML = `<i class="fa-solid fa-circle-question" aria-hidden="true"></i>`;
      descBtn.style.cssText = "background:transparent!important;border:none!important;cursor:pointer;padding:2px 3px!important;font-size:14px!important;line-height:1!important;color:var(--trench-color,#000)!important;display:inline-flex!important;align-items:center!important;";
      descBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });

      // Panel is only built the first time someone hovers the button, so a
      // full render no longer appends one hidden <div> to <body> per asset.
      let descPanel = null;
      const ensureDescPanel = () => {
        if (descPanel) return descPanel;
        descPanel = document.createElement("div");
        descPanel.className = "description-panel";
        descPanel.setAttribute("role", "tooltip");
        descPanel.innerHTML = `
          <div class="desc-head">
            <img alt="" />
            <div><span class="desc-title"></span><span class="desc-author"></span></div>
          </div>
          <div class="alert-text"></div>`;
        const headImg = descPanel.querySelector(".desc-head img");
        headImg.src = imageSrc || config.fallbackImage;
        headImg.onerror = () => { headImg.onerror = null; headImg.src = config.fallbackImage; };
        descPanel.querySelector(".desc-title").textContent = title || "Untitled";
        const authorLine = descPanel.querySelector(".desc-author");
        if (author) authorLine.textContent = author; else authorLine.remove();
        const descAlertText = descPanel.querySelector(".alert-text");
        descAlertText.textContent = descMsg;
        descAlertText.classList.toggle("is-empty", !descText);
        descPanel.addEventListener("mouseleave", () => descPanel.classList.remove("desc-visible"));
        document.body.appendChild(descPanel);
        return descPanel;
      };

      descBtn.addEventListener("mouseenter", () => {
        const panel = ensureDescPanel();
        requestAnimationFrame(() => panel.classList.add("desc-visible"));
      });
      descBtn.addEventListener("mouseleave", () => {
        setTimeout(() => {
          if (descPanel && !descPanel.matches(":hover")) descPanel.classList.remove("desc-visible");
        }, 80);
      });

      const bugBtn = document.createElement("button");
      bugBtn.className = "asset-action-btn asset-bug-btn";
      bugBtn.title     = `Report "${title || "this asset"}"?`;
      bugBtn.innerHTML = `<i class="fa-solid fa-biohazard" aria-hidden="true"></i>`;
      bugBtn.style.cssText = "background:transparent!important;border:none!important;cursor:pointer;padding:2px 3px!important;font-size:14px!important;line-height:1!important;color:var(--trench-color,#000)!important;display:inline-flex!important;align-items:center!important;";
      bugBtn.setAttribute("aria-haspopup", "true");
      bugBtn.setAttribute("aria-expanded", "false");

      // Appended to document.body (not nested under #container), so
      // #container div's overflow:hidden and higher-specificity display/
      // width/padding reset never touch it. Built lazily on first open —
      // most cards never have their bug menu opened at all.
      let bugMenu = null;

      const closeBugMenu = () => {
        if (!bugMenu) return;
        bugMenu.style.display = "none";
        bugMenu.setAttribute("aria-hidden", "true");
        bugBtn.setAttribute("aria-expanded", "false");
        if (window._openBugMenu === bugMenu) window._openBugMenu = null;
      };

      const ensureBugMenu = () => {
        if (bugMenu) return bugMenu;
        bugMenu = document.createElement("div");
        bugMenu.className = "asset-bug-menu";
        bugMenu.setAttribute("aria-hidden", "true");
        bugMenu._bugBtn = bugBtn;

        const head = document.createElement("p");
        head.className = "asset-bug-head";
        head.textContent = "Report a problem";
        bugMenu.appendChild(head);

        for (const reason of BUG_REASONS) {
          const item = document.createElement("button");
          item.type = "button";
          item.innerHTML = `<i class="fa-solid ${BUG_ICONS[reason] || "fa-flag"}" aria-hidden="true"></i><span></span>`;
          item.querySelector("span").textContent = reason;
          item.addEventListener("click", (e) => {
            e.preventDefault(); e.stopPropagation();
            closeBugMenu();
            window._openBugReportModal?.({ title, author, image: imageSrc, reason });
          });
          bugMenu.appendChild(item);
        }

        const elseItem = document.createElement("button");
        elseItem.type = "button";
        elseItem.className = "asset-bug-else";
        elseItem.innerHTML = `<i class="fa-solid fa-comment-dots" aria-hidden="true"></i><span>Something else</span>`;
        elseItem.title = "Opens our report board in a new tab";
        elseItem.addEventListener("click", (e) => {
          e.preventDefault(); e.stopPropagation();
          window.open(PADLET_URL, "_blank");
          closeBugMenu();
        });
        bugMenu.appendChild(elseItem);

        document.body.appendChild(bugMenu);
        return bugMenu;
      };

      bugBtn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        const menu   = ensureBugMenu();
        const isOpen = menu.style.display === "flex";
        if (window._openBugMenu && window._openBugMenu !== menu) {
          window._openBugMenu.style.display = "none";
          window._openBugMenu.setAttribute("aria-hidden", "true");
          if (window._openBugMenu._bugBtn) window._openBugMenu._bugBtn.setAttribute("aria-expanded", "false");
        }
        if (isOpen) {
          closeBugMenu();
        } else {
          menu.style.display = "flex";
          const rect = bugBtn.getBoundingClientRect();
          const menuWidth = menu.offsetWidth || 190;
          const maxLeft = window.scrollX + document.documentElement.clientWidth - menuWidth - 8;
          const left = Math.max(8, Math.min(rect.left + window.scrollX, maxLeft));
          menu.style.left = `${left}px`;
          menu.style.top  = `${rect.bottom + window.scrollY + 6}px`;
          menu.setAttribute("aria-hidden", "false");
          bugBtn.setAttribute("aria-expanded", "true");
          window._openBugMenu = menu;
        }
      });

      const actionsRow = document.createElement("div");
      actionsRow.className = "card-actions";
      actionsRow.style.cssText = "display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:center!important;gap:2px!important;width:100%!important;";
      actionsRow.appendChild(star);
      actionsRow.appendChild(dlBtn);
      actionsRow.appendChild(descBtn);
      actionsRow.appendChild(bugBtn);

      card.append(a, titleEl, authorEl, actionsRow);
      return { card, m, face: [a, titleEl, authorEl, actionsRow] };
    };

    for (const group of bundles) {
      const versions = group.map((asset, i) => buildCard(asset, i === 0));
      const card = versions[0].card;
      if (versions.length > 1) _makeBundle(card, versions);
      builtCards.push(card);
      window._allCards.push(card);
    }

    indexCardPages(builtCards);
    for (const card of orderCards(builtCards)) frag.appendChild(card);
    container.appendChild(frag);
    if (window.WS_Grid) window.WS_Grid.refresh();

    if (!window._pageLoadState) window._pageLoadState = new Map();

    const pagePromiseMap = new Map();
    for (const { promise, page, card } of imagePromises) {
      if (!pagePromiseMap.has(page)) pagePromiseMap.set(page, { promises: [], cards: [] });
      pagePromiseMap.get(page).promises.push(promise);
      pagePromiseMap.get(page).cards.push(card);
    }

    for (const [pageNum, { promises, cards }] of pagePromiseMap) {
      const isActive = pageNum === activePage;

      let settled = 0;
      const total = cards.length;
      cards.forEach((card, i) => {
        promises[i].finally(() => {
          setTimeout(() => {
            card.classList.add("ready");
            settled++;
            if (settled === total && typeof window.renderPage === "function") {
              window.renderPage();
            }
          }, isActive ? i * 30 : i * 60);
        });
      });

      const pageSettled = Promise.allSettled(promises).then(() => {
        window._pageLoadState.set(pageNum, "loaded");

        if (+window.currentPage === pageNum) {
          if (isActive) {
            runLoaderSequence();
          } else {

            _dismissPageLoader(pageNum);
          }
        }
      });

      if (!window._pageLoadState.has(pageNum)) {
        window._pageLoadState.set(pageNum, pageSettled);
      }

      if (isActive) {
        pageSettled.then(() => {});

      }
    }

    if (!pagePromiseMap.has(activePage)) {
      window._pageLoadState.set(activePage, "loaded");
      runLoaderSequence();
      if (typeof window.renderPage === "function") window.renderPage();
    }

    return imagePromises;
  }

  function initPaging() {
    const { container, pageIndicator, searchInput, searchBtn } = dom || {};
    if (!container) return;

    let activeCategories = new Set();

    window._cardIndex = new Map();
    window._allCards  = [];

    const getFilteredCards = () => window._allCards.filter(c => c.dataset.filtered === "true");
    const favViewOn        = () => !!window.WS_Favorites?.viewOn;

    // Favorited cards in the order they were favorited → { page, order }.
    // Favorites for assets that are no longer in the sheet (or hidden) have
    // no card and simply don't take up a slot. Rebuilt per render so an
    // add/remove re-flows every favorites page.
    const getFavLayout = () => {
      const byKey = new Map();
      // A bundle answers to every version's key; favoriting two of its
      // versions still gives it one slot.
      for (const c of window._allCards) for (const k of c._favKeys || [c._favKey]) if (k) byKey.set(k, c);
      const layout = new Map();
      let n = 0;
      for (const key of window.WS_Favorites?.list() || []) {
        const c = byKey.get(key);
        if (!c || layout.has(c)) continue;
        layout.set(c, { page: Math.floor(n / FAV_PAGE_SIZE) + 1, order: n });
        n++;
      }
      return layout;
    };
    const favPageCount = (layout) => Math.ceil(layout.size / FAV_PAGE_SIZE);

    const getPages = () => favViewOn()
      ? Array.from({ length: favPageCount(getFavLayout()) }, (_, i) => i + 1)
      : [...window._cardIndex.keys()].sort((a, b) => a - b);

    let errorGif = document.getElementById("noResultsGif");
    if (!errorGif) {
      errorGif = document.createElement("img");
      errorGif.id        = "noResultsGif";

      if (typeof applyGifToImg === "function") {
        applyGifToImg(errorGif, _getTheme(), "searching");
      } else {
        errorGif.src = getThemeGifSrc(_getTheme(), "searching");
        errorGif.dataset.gifState = "searching";
      }
      errorGif.draggable = false;
      Object.assign(errorGif.style, {
        display: "none", position: "absolute",
        top: "50%", left: "50%", transform: "translate(-50%, 0)",
        transformOrigin: "50% 0%", width: "128px", height: "128px",
        opacity: "0", transition: "opacity 0.25s ease",
        pointerEvents: "auto", cursor: "grab", zIndex: "1000",
        imageRendering: "pixelated",
      });
      container.parentElement.appendChild(errorGif);
      initGifDrag(errorGif);
    }

    const updateVisibility = (visible = getFilteredCards().length) => {
      if (visible === 0) {
        errorGif.style.display = "block";
        requestAnimationFrame(() => (errorGif.style.opacity = "1"));
      } else {
        errorGif.style.opacity = "0";
        setTimeout(() => { if (parseFloat(errorGif.style.opacity) === 0) errorGif.style.display = "none"; }, 250);
      }
    };

    // Favorites view: only favorited cards, on their own pages, in the order
    // they were added (CSS `order` — the grid's DOM order is left alone).
    // Their sheet page is ignored, so the per-sheet-page loader gate below
    // doesn't apply; each card still waits for its own image ("ready").
    const renderFavPage = () => {
      const layout = getFavLayout();
      const pages  = favPageCount(layout) || 1;
      const cur    = Math.min(Math.max(1, +window.currentPage || 1), pages);
      window.currentPage = cur;

      let matches = 0;
      for (const c of window._allCards) {
        const slot = layout.get(c);
        const ok   = !!slot && c.dataset.filtered === "true";
        if (ok) matches++;
        const want = ok && slot.page === cur && c.classList.contains("ready") ? "flex" : "none";
        if (c.style.display !== want) c.style.display = want;
        c.style.order = slot ? String(slot.order) : "";
      }

      if (pageIndicator) pageIndicator.textContent = `Page ${cur}/${pages}`;
      updateVisibility(matches);
    };

    // Paging settings (paging.js, set on the Settings page), with the
    // pageless overrides already applied.
    const paging = () => window.WS_Paging?.effective()
      || { layout: "paged", order: "sheet", filterScope: "local", searchScope: "global", flipAlign: false };
    const isPageless = () => !favViewOn() && paging().layout === "pageless";

    // Set by filterAssets: a search or filter is narrowing the cards, and
    // whether it's showing matches from every page at once (the page
    // arrows do nothing then).
    let narrowing   = false;
    let spanningAll = false;

    const paintPagingMode = () => document.body.classList.toggle("ws-pageless", isPageless());

    window.renderPage = () => {
      if (favViewOn()) { renderFavPage(); return; }
      paintPagingMode();
      const pages = getPages();

      if (!pages.length) {

        if (Array.isArray(window.assetsData)) {
          if (pageIndicator) pageIndicator.textContent = "Page 1/1";
          sessionStorage.setItem("currentPage", 1);
        }
        return;
      }

      if (!window._pageRestored) {
        const saved = +sessionStorage.getItem("currentPage") || pages[0];
        window.currentPage = pages.includes(saved) ? saved : pages[0];
        window._pageRestored = true;
      }

      const cur = +window.currentPage;
      const pageState = window._pageLoadState?.get(cur);
      const pageFullyLoaded = pageState === "loaded";
      // Pageless: every page's cards at once. The current page still gates
      // the first paint, so nothing shows under the loader gif.
      const pageless = isPageless();

      let here = 0;
      for (const [pageNum, cards] of window._cardIndex) {
        const onThisPage = pageless || pageNum === cur;
        for (const c of cards) {
          const isReady = c.classList.contains("ready");
          const match   = c.dataset.filtered === "true";
          if (onThisPage && match) here++;

          const want = onThisPage && isReady && pageFullyLoaded && match ? "flex" : "none";
          if (c.style.display !== want) c.style.display = want;
        }
      }

      if (pageIndicator) {
        if (pageless) {
          pageIndicator.textContent = narrowing ? `${here} found` : "All pages";
        } else {
          const idx = pages.indexOf(cur);
          // Local search/filters: matches on this page, other pages still flip.
          pageIndicator.textContent = `Page ${idx + 1}/${pages.length}` + (narrowing ? ` · ${here} here` : "");
        }
      }

      if (!pageless) sessionStorage.setItem("currentPage", cur);
      updateVisibility(here);
    };

    window.filterAssets = (q) => {
      const query      = safeStr(q).toLowerCase().trim();
      const words      = query.length ? query.split(/\s+/) : null;
      const isSearching = query.length > 0;
      const hasTags      = activeCategories.size > 0;
      let matches        = 0;

      for (const c of window._allCards) {
        const tagOk = !hasTags
          || activeCategories.has(c.dataset.category)
          || activeCategories.has(c.dataset.subcategory);

        if (!tagOk) { c.dataset.filtered = "false"; continue; }
        if (!words) { c.dataset.filtered = "true"; continue; }
        const haystack = c._hay ?? (c.dataset.title + " " + c.dataset.author);
        let hit = haystack.includes(query);
        if (!hit) for (const w of words) if (haystack.includes(w)) { hit = true; break; }
        c.dataset.filtered = hit ? "true" : "false";
      }

      // Global search (the default) and global category filters ignore page
      // boundaries and show every match at once. Local ones keep the pages:
      // renderPage shows this page's matches and the arrows still flip.
      // Pageless has no pages to keep, so renderPage covers it. The
      // favorites view always searches every favorite at once.
      const p = paging();
      narrowing   = isSearching || hasTags;
      spanningAll = !isPageless() && (
        isSearching ? (favViewOn() || p.searchScope === "global")
                    : (hasTags && !favViewOn() && p.filterScope === "global"));

      if (spanningAll) {
        const favLayout = favViewOn() ? getFavLayout() : null;
        for (const c of window._allCards) {
          c.classList.remove("tag-excluded");
          const inView = !favLayout || favLayout.has(c);
          if (inView && c.dataset.filtered === "true") matches++;
          const show = inView && c.classList.contains("ready") && c.dataset.filtered === "true";
          c.style.display = show ? "flex" : "none";
        }
        if (pageIndicator) {
          pageIndicator.textContent = !isSearching ? "Filtering all pages…"
            : hasTags ? "Searching within tags…" : "Searching all pages…";
        }
        const pagesAnchor = document.querySelector(".pages-anchor");
        if (pagesAnchor) pagesAnchor.style.visibility = "hidden";
        updateVisibility(matches);
      } else {
        for (const c of window._allCards) c.classList.remove("tag-excluded");
        const pagesAnchor = document.querySelector(".pages-anchor");
        if (pagesAnchor) pagesAnchor.style.visibility = "";
        renderPage(); // also updates the no-results gif
      }
    };

    // The per-sheet-page loader only applies to main pages; favorites pages
    // mix cards from every sheet page (see renderFavPage).
    // Nothing to flip while pageless or while every page's matches are up.
    const canFlipPages = () => !window._reloading && !spanningAll && !isPageless();

    // Page flip align (Settings): land at the top of the new page instead
    // of at the same scroll position.
    const alignAfterFlip = () => {
      if (paging().flipAlign) window.scrollTo({ top: 0, behavior: "instant" });
    };

    window.prevPage = () => {
      if (!canFlipPages()) return;
      const pages = getPages();
      const i     = pages.indexOf(+window.currentPage);
      window.currentPage = i <= 0 ? pages[pages.length - 1] : pages[i - 1];
      if (!favViewOn()) _handlePageNavigation(+window.currentPage);
      renderPage();
      alignAfterFlip();
    };

    window.nextPage = () => {
      if (!canFlipPages()) return;
      const pages = getPages();
      const i     = pages.indexOf(+window.currentPage);
      window.currentPage = i === -1 || i === pages.length - 1 ? pages[0] : pages[i + 1];
      if (!favViewOn()) _handlePageNavigation(+window.currentPage);
      renderPage();
      alignAfterFlip();
    };

    // Settings changed (here or in the Settings tab): re-order the cards in
    // place (no rebuild, no refetch) and re-apply the search/filters.
    document.addEventListener("ws:paging-changed", () => {
      if (!window._allCards.length) { paintPagingMode(); return; }
      indexCardPages(window._allCards);
      container.append(...orderCards(window._allCards));
      filterAssets(searchInput ? searchInput.value : "");
    });

    // ── Header favorites toggle ─────────────────────────────────────────
    // On: only favorites show, paged on their own. Off: main assets as
    // usual. Each view remembers its own page while you flip between them.
    // Deliberately not persisted across reloads, so the first render (and
    // the loader it waits on) is always the main grid.
    const favBtn = document.getElementById("fav-btn");
    const favImg = favBtn?.querySelector("img");
    let savedMainPage = 1;
    let savedFavPage  = 1;

    const paintFavBtn = (on) => {
      if (!favBtn) return;
      if (favImg) favImg.src = favImg.src.replace(/(faved|unfav)\.gif(\?.*)?$/, on ? "faved.gif" : "unfav.gif");
      favBtn.title = on ? "Showing favorites (click for all assets)" : "Show favorites";
      favBtn.setAttribute("aria-pressed", String(on));
    };

    favBtn?.addEventListener("click", () => {
      if (window._reloading || !window.WS_Favorites) return;
      const on = !favViewOn();
      if (on) savedMainPage = +window.currentPage || 1;
      else    savedFavPage  = +window.currentPage || 1;

      window.WS_Favorites.viewOn = on;
      window.currentPage = on ? savedFavPage : savedMainPage;
      if (!on) for (const c of window._allCards) c.style.order = "";

      paintFavBtn(on);
      filterAssets(searchInput ? searchInput.value : "");
    });
    paintFavBtn(false);

    function _handlePageNavigation(pageNum) {
      const pageState = window._pageLoadState?.get(pageNum);
      if (pageState === "loaded" || pageState === undefined) {

        return;
      }

      const loader = document.getElementById("containerLoader");
      if (!loader) {

        const newLoader = document.createElement("div");
        newLoader.id = "containerLoader";
        const loaderImg = document.createElement("img");
        loaderImg.alt = "";
        applyGifToImg(loaderImg, _getTheme(), "loading");
        newLoader.appendChild(loaderImg);
        document.body.appendChild(newLoader);
        window._loaderSequenceRunning = false;
        document.body.classList.add("ws-loading");
      } else {

        const img = loader.querySelector("img");
        if (img) applyGifToImg(img, _getTheme(), "loading");
        window._loaderSequenceRunning = false;
        document.body.classList.add("ws-loading");
        loader.style.display = "";
      }

      Promise.resolve(pageState).then(() => {
        _dismissPageLoader(pageNum);
      });
    }

    searchInput?.addEventListener("input", debounce(() => filterAssets(searchInput.value), 200));
    searchInput?.addEventListener("input", () => fitInputText(searchInput, searchInput.value));
    window.addEventListener("resize", debounce(() => {
      if (searchInput) fitInputText(searchInput, searchInput.value || searchInput.placeholder);
    }, 150));

    const devPrev = document.getElementById("devPrevBtn");
    const devNext = document.getElementById("devNextBtn");
    if (devPrev) devPrev.addEventListener("click", () => window.prevPage?.());
    if (devNext) devNext.addEventListener("click", () => window.nextPage?.());

    window.currentPage = +sessionStorage.getItem("currentPage") || 1;
    renderPage();

    (function initSubHeaderFilter() {

      const subBtns = document.querySelectorAll(".sub-header button");
      const dropdownBtns = [];

      function toggleCategory(cat) {
        if (!cat) return;
        if (activeCategories.has(cat)) activeCategories.delete(cat);
        else activeCategories.add(cat);

        const allBtns = [...subBtns, ...dropdownBtns];
        allBtns.forEach(b => b.classList.toggle("active", activeCategories.has(b.dataset.category)));

        window.filterAssets(searchInput ? searchInput.value : "");
      }

      subBtns.forEach(btn => {
        const cat = (btn.dataset.category || btn.textContent).trim().toLowerCase();
        btn.dataset.category = cat;
        btn.addEventListener("click", () => toggleCategory(cat));
      });

      // ---- Dynamic category/sub-category dropdown, built from the same fetched asset data ----
      const menu    = document.getElementById("searchCategoryMenu");
      const catList = document.getElementById("searchCategoryList");
      const subList = document.getElementById("searchSubcategoryList");

      function refreshCategoryDropdown() {
        if (!catList || !subList) return;

        dropdownBtns.length = 0;
        catList.innerHTML = "";
        subList.innerHTML = "";

        const sourceRows = window.assetsData || [];

        const cats = new Set();
        const subs = new Set();
        for (const a of sourceRows) {
          const m = getAssetMeta(a);
          if (m.categoryRaw)    cats.add(m.categoryRaw);
          if (m.subcategoryRaw) subs.add(m.subcategoryRaw);
        }

        if (!cats.size && !subs.size && sourceRows.length) {
          console.error(
            "[CategoryDropdown] No category/sub-category fields matched on any asset row. " +
            "Looked for keys like 'category'/'categories'/'cat' and 'sub-category'/'subcategory'/'subcat'. " +
            "Actual keys on the first asset row were:",
            Object.keys(sourceRows[0])
          );
        }

        const buildItem = (label, list) => {
          const el = document.createElement("button");
          el.type = "button";
          el.textContent = label;
          el.dataset.category = label.toLowerCase();
          if (activeCategories.has(el.dataset.category)) el.classList.add("active");
          el.addEventListener("click", () => toggleCategory(el.dataset.category));
          dropdownBtns.push(el);
          list.appendChild(el);
        };

        if (cats.size) {
          [...cats].sort(fastCompare).forEach(c => buildItem(c, catList));
        } else {
          const p = document.createElement("p");
          p.textContent = "No categories yet";
          catList.appendChild(p);
        }

        if (subs.size) {
          [...subs].sort(fastCompare).forEach(s => buildItem(s, subList));
        } else {
          const p = document.createElement("p");
          p.textContent = "No sub-categories yet";
          subList.appendChild(p);
        }
      }

      let toggleMenu = () => {};

      if (menu && searchBtn) {
        menu.style.display    = "none";
        menu.style.opacity    = "0";
        menu.style.transition = "opacity 0.3s ease, transform 0.3s ease";

        toggleMenu = (force) => {
          const isVisible = menu.style.display === "block";
          const show = force !== undefined ? force : !isVisible;
          if (!show) {
            menu.style.opacity = "0";
            searchBtn.setAttribute("aria-expanded", "false");
            menu.setAttribute("aria-hidden", "true");
            setTimeout(() => (menu.style.display = "none"), 300);
          } else {
            refreshCategoryDropdown();
            menu.style.display = "block";
            searchBtn.setAttribute("aria-expanded", "true");
            menu.setAttribute("aria-hidden", "false");
            setTimeout(() => (menu.style.opacity = "1"), 10);
          }
        };

        searchBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleMenu();
        });
        document.addEventListener("click", (e) => {
          if (
            menu.style.display === "block" &&
            !menu.contains(e.target) &&
            e.target !== searchBtn
          ) toggleMenu(false);
        });
      }

      window._refreshCategoryDropdown = refreshCategoryDropdown;
    })();
  }

  let _searchQuotes     = null;
  let _searchQuotesIdx  = 0;

  // Served by the same QuoteSystemWS sheet as the main quote box (column A) —
  // column B is the dedicated search-placeholder list, B1 header / B2:B... data.
  // With the data cache on, the saved list is used and only an R refetch
  // (ws:refetch) goes back to DATA for a fresh one.
  async function _loadSearchQuotes(force = false) {
    if (_searchQuotes !== null && !force) return _searchQuotes;
    const cache = window.WS_DataCache;
    if (!force && cache?.enabled()) {
      const saved = await cache.read("searchquotes");
      if (Array.isArray(saved)) return (_searchQuotes = saved);
    }
    try {
      const url = `${window.config.sheetUrl}?type=searchQuotes`;
      await ticketReady();
      const data = await fetchJSONRetry(() => bustCache(url));
      const values = data && typeof data === "object" && !Array.isArray(data)
        ? Object.values(data)[0]
        : null;
      _searchQuotes = Array.isArray(values)
        ? values.filter(q => typeof q === "string" && q.trim())
        : [];
      if (_searchQuotes.length && cache?.enabled()) cache.write("searchquotes", _searchQuotes);
    } catch {
      if (_searchQuotes === null) _searchQuotes = [];
    }
    return _searchQuotes;
  }
  document.addEventListener("ws:refetch", () => {
    if (window.WS_DataCache?.enabled()) _loadSearchQuotes(true);
  });

  function _nextSearchQuote() {
    if (!_searchQuotes || !_searchQuotes.length) return "Search assets...";
    const q = _searchQuotes[_searchQuotesIdx % _searchQuotes.length];
    _searchQuotesIdx++;
    return q;
  }

  function initPlaceholders() {
    const { searchInput } = dom || {};
    if (!searchInput) return;

    const FADE = 450, HOLD = 4000;

    const fadePlaceholder = (input, text, cb) => {
      input.classList.remove("fade-in");

      void input.offsetWidth;
      input.classList.add("fade-out");
      setTimeout(() => {
        const shown = truncateText(text, 26);
        input.placeholder = shown;
        input.title = text;
        fitInputText(input, shown);
        input.classList.remove("fade-out");
        void input.offsetWidth;
        input.classList.add("fade-in");
        setTimeout(() => { input.classList.remove("fade-in"); cb?.(); }, FADE);
      }, FADE);
    };

    window.startPlaceholderCycle = () => {
      if (window._placeholderRunning) return;
      window._placeholderRunning = true;

      _loadSearchQuotes();

      const loop = async () => {

        await new Promise(r => fadePlaceholder(searchInput, _nextSearchQuote(), r));
        await delay(HOLD);

        const pageless = !window.WS_Favorites?.viewOn && window.WS_Paging?.effective().layout === "pageless";
        const visible = window.WS_Favorites?.viewOn
          ? (window._allCards || []).filter(c => c.style.display === "flex").length
          : (pageless ? window._allCards || [] : window._cardIndex?.get(+window.currentPage) || [])
              .filter(c => c.dataset.filtered === "true").length;
        await new Promise(r => fadePlaceholder(searchInput, `${visible} assets ${pageless ? "in view" : "on this page"}`, r));
        await delay(HOLD);

        if (window._placeholderRunning) loop();
      };
      loop();
    };
  }

  let _resolveSheetData;
  window._sheetDataReady = new Promise(res => { _resolveSheetData = res; });

  function _isValidAssetsShape(data) {
    return Array.isArray(data);
  }

  // Early access: the tester builds (type "early access" / "tester") are
  // saved for the credits page (ws_tester_assets), and any not announced
  // before get one alert pointing there (ws_tester_seen, by link). Waits
  // for the tour to finish so it doesn't pop up over it.
  const TESTER_LIST_KEY = "ws_tester_assets";
  const TESTER_SEEN_KEY = "ws_tester_seen";
  function _noteEarlyAccess(rows) {
    const list = rows.map(getAssetMeta).filter((m) => m.earlyAccess && !m.hidden && m.linkTrim)
      .map((m) => ({ title: m.title, author: m.author, link: m.link, image: m.image, description: m.description }));
    try { localStorage.setItem(TESTER_LIST_KEY, JSON.stringify(list)); } catch (_) {}

    let seen;
    try { seen = JSON.parse(localStorage.getItem(TESTER_SEEN_KEY) || "[]"); } catch (_) { seen = []; }
    if (!Array.isArray(seen)) seen = [];
    const fresh = list.filter((a) => !seen.includes(a.link));
    if (!fresh.length) return;

    const announce = () => {
      try { localStorage.setItem(TESTER_SEEN_KEY, JSON.stringify(list.map((a) => a.link))); } catch (_) {}
      const n = fresh.length;
      window.WS_Alert?.show({
        icon: "stars",
        title: n === 1 ? "New tester asset available" : `${n} new tester assets available`,
        text: n === 1
          ? `"${fresh[0].title || "Untitled"}" is out for testers. Find it under Early access in Credits & achievements.`
          : `${fresh.slice(0, 3).map((a) => `"${a.title || "Untitled"}"`).join(", ")}${n > 3 ? " and more" : ""} are out for testers. Find them under Early access in Credits & achievements.`,
        action: { label: "Open Credits & achievements", href: new URL("system/pages/credits-n-achievements/index.html#early", _siteRoot()).href },
        duration: 12000,
      });
    };
    if (window.WS_Tutorial?.pending() || window.WS_Tutorial?.active()) {
      document.addEventListener("ws:tutorial-done", () => setTimeout(announce, 800), { once: true });
    } else setTimeout(announce, 1500);
  }
  // The site root, from this script's URL (index.html and pages/main.html alike).
  const _siteRoot = () => new URL("../../", document.querySelector("script[src*='js/main.js']")?.src || location.href);

  // A load from the data cache skips the asset fetch, which is where the
  // server would normally refuse a revoked ticket, so the ticket is checked
  // on its own in the background (one small request). Refused: the saved
  // copy is deleted and the ticket gate comes back, as with a live fetch.
  // Unreachable (offline): the saved copy keeps working.
  function _recheckTicket() {
    const T = window.WS_Ticket;
    if (!T?.check) return;
    T.check().then((st) => {
      if (st === "approved") return;
      window.WS_DataCache?.clear();
      T.revoke(st);
    }).catch(() => {});
  }

  // Every load fetches live, unless the user turned on the data cache
  // (Settings → Page behaviour, datacache.js): then the saved copy is used
  // and DATA isn't contacted until R refetches. With the cache off there's
  // no fallback: if the live fetch fails, that surfaces as a visible crash,
  // not a quiet substitution of old data.
  async function loadAssets() {
    const fetchUrl = window._activeFetchUrl || config.sheetUrl;
    const cacheable = fetchUrl === config.sheetUrl && !!window.WS_DataCache?.enabled();
    let raw;

    // No fetch at all until this browser's access ticket is approved; the
    // ticket gate (ticket.js) is up over the loader meanwhile.
    await ticketReady();

    // The <head> of index.html starts this exact request before the rest of
    // the page (css, cdn scripts, this file) has even downloaded. Use it once
    // on first load if it's for the same endpoint; reloads always refetch live.
    const early = window.__wsAssetsPrefetch;
    window.__wsAssetsPrefetch = null;

    // Saved copy (data cache on, and not an R refetch).
    if (cacheable && !window._forceRefetch) {
      raw = await window.WS_DataCache.read("assets");
      if (Array.isArray(raw)) {
        window.showToast?.("Loaded your saved copy. Press R to refetch.", 2600);
        _recheckTicket();
      } else raw = undefined;
    }

    if (raw === undefined) try {
      if (early && early.url === fetchUrl && early.promise) {
        raw = await early.promise;
      } else {
        raw = await fetchJSONRetry(() => bustCache(fetchUrl));
      }
      // A stored ticket the server no longer accepts (revoked or removed in
      // TicketApprovalWS): reopen the gate and try again once approved,
      // rather than crashing.
      if (raw && !Array.isArray(raw) && raw.ticket && window.WS_Ticket) {
        await window.WS_Ticket.revoke(raw.ticket);
        return loadAssets();
      }
      if (!_isValidAssetsShape(raw)) {
        console.error("[loadAssets] Network response is not a valid array:", raw);
        throw new Error("Invalid data from network");
      }
      if (cacheable) window.WS_DataCache.write("assets", raw);
    } catch (err) {
      console.error("[loadAssets] fetch failed:", err);
      _resolveSheetData();
      runCrashSequence();
      // Anything waiting on ws:assets-loaded (the tour) can stop waiting.
      document.dispatchEvent(new CustomEvent("ws:assets-failed", { detail: { error: String(err?.message || err) } }));
      throw err;
    }

    _resolveSheetData(raw);
    _rawAssets = raw;

    // Single pass: drops empty rows and pre-parses every field once.
    const data = prepareAssets(raw);
    window.assetsData = data;

    const savedPage = +sessionStorage.getItem("currentPage") || 1;
    window.currentPage   = savedPage;
    window._pageRestored = true;

    const earlyIndicator = window.dom?.pageIndicator;
    if (earlyIndicator) earlyIndicator.textContent = `Page ${savedPage}`;

    getLoadedGifDuration().catch(() => {});

    const promises = createAssetCards(data);

    const activePromises = promises.filter(p => p.page === savedPage).map(p => p.promise);
    const settle         = activePromises.length ? Promise.all(activePromises) : Promise.resolve();
    settle.finally(() => {
      if (typeof window._restoreScrollY === "function") window._restoreScrollY();
    });

    document.dispatchEvent(new CustomEvent("ws:assets-loaded", { detail: { assets: data } }));
    _noteEarlyAccess(data);

    return true;
  }

  window._reloading           = false;
  window._reloadCooldownUntil = 0;
  const RELOAD_COOLDOWN_MS    = 15000;

  window.reloadAssets = async function () {
    if (window._reloading) return;
    window._reloading          = true;
    window._pageRestored       = false;
    window._placeholderRunning = false;

    sessionStorage.removeItem("scrollY");

    window._cardIndex = new Map();
    window._allCards  = [];
    window._pageLoadState = new Map();

    document.body.classList.add("ws-loading");

    document.getElementById("containerLoader")?.remove();
    const loader = document.createElement("div");
    loader.id = "containerLoader";

    const loaderImg = document.createElement("img");
    loaderImg.alt = "";
    applyGifToImg(loaderImg, _getTheme(), "loading");
    loader.appendChild(loaderImg);
    document.body.appendChild(loader);
    window._loaderSequenceRunning = false;

    window._sheetDataReady = Promise.resolve();
    _resolveSheetData = () => {};

    // R always goes to DATA, data cache or not; the quote box and search
    // quotes refresh their saved copies on this too.
    window._forceRefetch = true;
    document.dispatchEvent(new CustomEvent("ws:refetch"));

    try {
      await loadAssets();
      window._reloadCooldownUntil = Date.now() + RELOAD_COOLDOWN_MS;
      if (typeof window.startPlaceholderCycle === "function") window.startPlaceholderCycle();
      return true;
    } catch {
      throw new Error("reload failed");
    } finally {
      window._reloading = false;
      window._forceRefetch = false;
    }
  };

  function initMuteButton() {
    const MUTE_KEY = "ws_muted";

    window._quotesMuted = localStorage.getItem(MUTE_KEY) === "true";

    function _applyAudioMute(muted) {
      document.querySelectorAll("audio, video").forEach(a => { a.muted = muted; });
    }

    _applyAudioMute(window._quotesMuted);

    const _audioObserver = new MutationObserver(() => {
      _applyAudioMute(window._quotesMuted);
    });
    _audioObserver.observe(document.body, { childList: true, subtree: true });

    window.WS_Audio = {
      setMuted: function (value) {
        window._quotesMuted = !!value;
        _applyAudioMute(window._quotesMuted);
      },
      isMuted: function () {
        return window._quotesMuted;
      }
    };
  }

  document.addEventListener("DOMContentLoaded", async () => {
    initElements();
    initFavorites();
    initPaging();
    initPlaceholders();
    initMuteButton();

    window.applyThemeGifs?.(_getTheme());

    await loadAssets().catch(() => {});
    window._refreshCategoryDropdown?.();

    if (typeof window.startPlaceholderCycle === "function") window.startPlaceholderCycle();
  });
})();