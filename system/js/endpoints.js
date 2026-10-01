"use strict";

// ── Backend endpoints ──────────────────────────────────────────────────
// The three Apps Script projects (.documentation/api/) and what each serves:
//
//   data  data.gs  assets, devbuild, quotes, sync, tickets
//                  (main.js, quotes.js, ticket.js, devbuild.js, index.html prefetch)
//   cust  cust.gs  themes, widgets, banners, gif packs, frames, wrappers
//                  (themify.js, widgets.js, profile.js, frames.js, wrappers.js,
//                  store page)
//   mod   mod.gs   word filter, taken usernames — open, no ticket
//                  (wordfilter.js)
//
// Paste each project's /exec URL here after deploying it. This file loads
// first on every page (before wordfilter.js in <head>), so everything else
// can read window.WS_ENDPOINTS.
//
window.WS_ENDPOINTS = Object.freeze({
  data: "https://script.google.com/macros/s/AKfycbxG3GniyjGks4y1uByIqzQlQJ_og6fjmBPumjiVr4nVLt6J8bwd4EJrJZbn8Jvax3dK/exec",
  cust: "https://script.google.com/macros/s/AKfycbztiWN2Xfkot_i5keu7o3Sm5z9sbXyTvDwIz9Yd23d-pg_Gl6ckIJrI71RV_K6jPIaM/exec",
  mod:  "https://script.google.com/macros/s/AKfycbyorR1RSI3-aYv91IIobUxMmNv8HKMyYvNKhwgR27AXetGROjkE_eYgBNyW5hwyPh_w/exec",
});

// ── General media (mediabaseWS) ────────────────────────────────────────
// Banners, profile pics, stickers and theme art live in their own repo,
// github.com/wannasmile4evr/mediabaseWS, not in this site:
//
//   assets/media/banners/         -> banners/<id>/splash.<ext>
//   assets/media/images/profile/  -> profile/
//   assets/media/stickers/        -> stickers/
//   assets/media/themes/          -> themes/
//   (new, never lived on this site)  frames/<id>/splash.<ext>, wrappers/<id>/splash.<ext>
//
// A sheet row or saved value may also just name the repo path directly
// ("banners/buni/splash.jpg", optionally with a "site:" prefix, which banner
// picks are saved with); those resolve against this repo too. Old flat
// banner names (banners/banner7.jpg) no longer exist there: the banners were
// renamed to per-id folders, so BannerWS rows must use the new paths.
//
// Sheet rows and browser caches can still hold old site paths, old repo URLs,
// or the former theme/gif-pack directories. Normalize those to this repo's
// current layout while leaving unrelated URLs alone.
window.WS_MEDIABASE = "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/main/";

window.toMediabase = (() => {
  const host = location.host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const moved = new RegExp(
    String.raw`^(?:site:|(?:https?:)?//(?:wannasmile4evr\.github\.io\.?${host ? "|" + host : ""})/(?:[^?#]*?/)?|/|(?:\.\.?/)*)` +
    String.raw`(?:assets/)?media/(banners|stickers|themes|images/profile)/`, "i");
  const direct = /^(?:site:)?((?:banners|stickers|themes|profile|frames|wrappers|gif-packs)\/.+)$/i;
  const oldRepo = /^https?:\/\/raw\.githubusercontent\.com\/wannasmile4evr\/(?:wannabase|mediabaseWS)\/main\/(.*)$/i;
  const normalizePath = (path) => path
    .replace(/^themes\/([^/]+)\/system-media\//i, "themes/$1/")
    .replace(/^themes\/([^/]+)\/gif-states\//i, "gif-packs/$1/");

  return (url) => {
    if (typeof url !== "string") return url;
    const v = url.trim();
    const m = v.match(moved);
    if (m) {
      const dir = m[1].toLowerCase() === "images/profile" ? "profile" : m[1].toLowerCase();
      return window.WS_MEDIABASE + normalizePath(dir + "/" + v.slice(m[0].length));
    }
    const old = v.match(oldRepo);
    if (old) return window.WS_MEDIABASE + normalizePath(old[1]);
    const d = v.match(direct);
    return d ? window.WS_MEDIABASE + normalizePath(d[1]) : url;
  };
})();
