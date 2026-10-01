"use strict";

// ── Card wrappers (WrapperWS) ──────────────────────────────────────────
// A wrapper is the profile card's BACKGROUND (not the banner): an image
// drawn behind everything on the card, scaled up until its height fills
// the card, centred, with any extra width cut off. The list comes from the
// CUST project (?type=wrappers, sheet "WrapperWS") and every wrapper's art
// lives at a predictable mediabaseWS path:
//
//   wrappers/<id>/splash.<ext>
//
// WrapperWS columns (row 1 = headers; matched case/space-insensitively):
//   id         folder name in mediabaseWS/wrappers/, lowercase, no spaces
//   name       what the card / tile shows
//   type       "soon" hides the row; anything else (or blank) shows it
//   ext        optional file extension of splash.<ext>: png (default), gif, webp, jpg
//   animated   TRUE when splash.png is animated (adds a tag)
//   pixelated  TRUE keeps pixel-art wrappers crisp when scaled up
//
// Opacity is NOT part of the sheet: it is the visitor's own setting, a slider
// in the profile modal's gear menu, saved as localStorage "pfpWrapperOpacity"
// (0-100, default 100) and applied to whichever wrapper is on.
//
// localStorage "pfpWrapper" holds the wrapper's full image URL ("" = none),
// so the card keeps working before the sheet has loaded. ws_wrapper_cache
// remembers the last good list for an instant / offline library.
(() => {
  const BASE      = "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/main/wrappers/";
  const FILE      = "splash";          // + "." + the row's ext (default png)
  const CACHE_KEY = "ws_wrapper_cache";
  const SAVED_KEY = "pfpWrapper";
  const OPACITY_KEY = "pfpWrapperOpacity";

  const yes = (v) => /^(true|yes|1)$/i.test(String(v || "").trim());
  const extOf = (v) => { const e = String(v || "").trim().toLowerCase().replace(/^\./, ""); return /^(png|gif|webp|jpg|jpeg|apng|avif)$/.test(e) ? e : "png"; };
  const urlFor = (id, ext) => `${BASE}${encodeURIComponent(String(id).trim().toLowerCase())}/${FILE}.${extOf(ext)}`;
  const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n)));

  function parseRow(row) {
    const get = (...n) => (typeof getFieldCI === "function" ? getFieldCI(row, ...n) : String(row?.[n[0]] ?? "")).trim();
    const id = get("id", "identification").toLowerCase();
    if (!id || get("type").toLowerCase() === "soon") return null;
    return {
      id,
      name:      get("name") || id,
      url:       urlFor(id, get("ext", "extension")),
      animated:  yes(get("animated")),
      pixelated: yes(get("pixelated")),
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
      .then(() => fetch(bustCache(`${window.WS_ENDPOINTS.cust}?type=wrappers`), { cache: "no-store" }))
      .then((r) => r.json())
      .then((rows) => {
        if (!Array.isArray(rows)) {
          const err = new Error((rows && rows.error) || "Wrapper feed did not return a list.");
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

  // Metadata for a saved value (a URL). Unknown wrappers get defaults.
  function meta(value) {
    const v = String(value || "");
    return cached().find((w) => w.url === v) || { id: "", name: "", url: v, animated: false, pixelated: false };
  }

  // The visitor's opacity setting as a 0-100 number (a slider value, never a
  // fraction); 100 when they haven't touched it.
  function opacityPct(raw) {
    const n = parseFloat(raw);
    return String(raw ?? "") !== "" && Number.isFinite(n) ? clampPct(n) : 100;
  }

  // Paints a wrapper onto a .pf-wrapper element ("" hides it). `opacity` is the
  // visitor's 0-100 setting (see opacityPct).
  function paint(el, value, opacity) {
    if (!el) return;
    if (!value) {
      el.hidden = true;
      el.style.removeProperty("--pf-wrapper-img");
      return;
    }
    const src = window.toMediabase ? window.toMediabase(value) : value;
    el.style.setProperty("--pf-wrapper-img", `url("${src}")`);
    el.style.setProperty("--pf-wrapper-opacity", String(opacityPct(opacity) / 100));
    el.style.imageRendering = meta(value).pixelated ? "pixelated" : "";
    el.hidden = false;
  }

  const read = (k) => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } };
  window.WSWrappers = { BASE, FILE, SAVED_KEY, OPACITY_KEY, urlFor, load, cached, meta, paint, opacityPct,
    saved: () => read(SAVED_KEY),
    savedOpacity: () => read(OPACITY_KEY),
  };
})();
