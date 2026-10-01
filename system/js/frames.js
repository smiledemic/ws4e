"use strict";

// ── Picture frames (FramesWS) ──────────────────────────────────────────
// Frames are transparent overlays drawn ON TOP of the profile picture.
// The list comes from the CUST project (?type=frames, sheet "FramesWS"),
// and every frame's art lives at a predictable mediabaseWS path:
//
//   frames/<id>/splash.png
//
// FramesWS columns (row 1 = headers; matched case/space-insensitively):
//   id         folder name in mediabaseWS/frames/, lowercase, no spaces
//   name       what the card / tile shows
//   type       "soon" hides the row; anything else (or blank) shows it
//   ext        optional file extension of splash.<ext>: png (default), gif, webp, jpg
//   animated   TRUE when splash.png is an animated PNG/GIF-in-PNG (adds a tag)
//   blend      optional CSS mix-blend-mode for frames that can't be transparent (.jpg):
//              screen = a black middle disappears, multiply = a white middle disappears
//              (also lighten, darken, overlay); blank = normal
//   scale      optional: frame size as a multiple of the picture (blank = 1.2)
//   pixelated  TRUE keeps pixel-art frames crisp when they are scaled up
//
// The value saved in localStorage "pfpFrame" is the frame's full image URL
// (or a data: URL for an uploaded frame; "" = no frame), so the header keeps
// working even before the sheet has loaded. ws_frame_cache remembers the last
// good list for an instant / offline library and for per-frame scale.
(() => {
  const BASE      = "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/main/frames/";
  const FILE      = "splash";          // + "." + the row's ext (default png)
  const CACHE_KEY = "ws_frame_cache";
  const SAVED_KEY = "pfpFrame";
  const DEFAULT_SCALE = 1.2;

  const BLENDS = ["multiply", "screen", "lighten", "darken", "overlay", "soft-light", "hard-light"];
  const blendOf = (v) => { const b = String(v || "").trim().toLowerCase(); return BLENDS.includes(b) ? b : ""; };
  const yes = (v) => /^(true|yes|1)$/i.test(String(v || "").trim());
  const extOf = (v) => { const e = String(v || "").trim().toLowerCase().replace(/^\./, ""); return /^(png|gif|webp|jpg|jpeg|apng|avif)$/.test(e) ? e : "png"; };
  const urlFor = (id, ext) => `${BASE}${encodeURIComponent(String(id).trim().toLowerCase())}/${FILE}.${extOf(ext)}`;

  function parseRow(row) {
    const get = (...n) => (typeof getFieldCI === "function" ? getFieldCI(row, ...n) : String(row?.[n[0]] ?? "")).trim();
    const id = get("id", "identification").toLowerCase();
    if (!id || get("type").toLowerCase() === "soon") return null;
    const scale = parseFloat(get("scale"));
    return {
      id,
      name:      get("name") || id,
      url:       urlFor(id, get("ext", "extension")),
      animated:  yes(get("animated")),
      pixelated: yes(get("pixelated")),
      blend:     blendOf(get("blend")),
      scale:     Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_SCALE,
    };
  }

  function cached() {
    try { const v = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (_) { return []; }
  }

  let _fetch = null;
  function load() {
    if (_fetch) return _fetch;
    _fetch = (typeof ticketReady === "function" ? ticketReady() : Promise.resolve())
      .then(() => fetch(bustCache(`${window.WS_ENDPOINTS.cust}?type=frames`), { cache: "no-store" }))
      .then((r) => r.json())
      .then((rows) => {
        if (!Array.isArray(rows)) {
          const err = new Error((rows && rows.error) || "Frame feed did not return a list.");
          err.ticket = rows && rows.ticket;
          throw err;
        }
        const list = rows.map(parseRow).filter(Boolean);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch (_) {}
        return list;
      })
      .catch((err) => {
        _fetch = null;                       // try again next time it's asked for
        const c = cached();
        if (c.length) return c;
        throw err;
      });
    return _fetch;
  }

  // Metadata for a saved value (a URL). Unknown / uploaded frames get defaults.
  function meta(value) {
    const v = String(value || "");
    const hit = cached().find((f) => f.url === v);
    return hit || { id: "", name: "", url: v, animated: false, pixelated: false, blend: "", scale: DEFAULT_SCALE };
  }

  // Paints a frame value onto a .pf-frame <img> ("" hides it).
  function paint(img, value) {
    if (!img) return;
    if (!value) { img.removeAttribute("src"); img.hidden = true; return; }
    const m = meta(value);
    const src = window.toMediabase ? window.toMediabase(value) : value;
    if (img.getAttribute("src") !== src) img.src = src;
    img.style.setProperty("--pf-frame-scale", String(m.scale));
    img.style.imageRendering = m.pixelated ? "pixelated" : "";
    img.style.mixBlendMode = m.blend || "";
    img.hidden = false;
  }

  window.WSFrames = { BASE, FILE, SAVED_KEY, DEFAULT_SCALE, urlFor, load, cached, meta, paint, blendOf,
    saved: () => { try { return localStorage.getItem(SAVED_KEY) || ""; } catch (_) { return ""; } },
  };
})();
