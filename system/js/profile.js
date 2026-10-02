"use strict";

const PROFILE_IMAGES = [
  "bleh", "catcher", "clown", "clowninabox", "dream", "eye", "eyes",
  "glitched", "me", "purpleu", "sleeppy", "smile", "starry", "starwalk", "yum",
].map(n =>
  `https://cdn.jsdelivr.net/gh/mcmattyobriore/yogurtyooo.github.io@main/system/images/profile/${n}.${n === "smile" ? "png" : "jpeg"}`
).concat(
  // Halloween set, hosted in the mediabaseWS repo (see endpoints.js).
  // The Left/Right pairs are matching pfps: one half each for two friends.
  [
    "skele.jpg",
    "pumpkinPalLeft.gif", "pumpkinPalRight.gif",
  ].map(f => `https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/main/profile/halloween/${f}`)
);

// Picture frames: transparent overlays drawn ON TOP of the picture (z-index
// above it), sized at a multiple of the picture and centred so ornate frames
// can overhang the edge. The list comes from the FramesWS sheet
// (?type=frames) and each frame's art is mediabaseWS frames/<id>/splash.png;
// see frames.js. The saved value is the frame's URL (or a data URL for an
// uploaded one) under "pfpFrame"; an empty value means no frame.
const FRAME_KEY     = "pfpFrame";
// Card wrapper: the card's background image (wrappers/<id>/splash.<ext>, from the
// WrapperWS sheet; see wrappers.js). "pfpWrapper" = URL, "pfpWrapperOpacity" =
// the visitor's own 0-100 setting from the gear menu (default 100).
const WRAPPER_KEY         = "pfpWrapper";
const WRAPPER_OPACITY_KEY = "pfpWrapperOpacity";
const FRAME_GIF_MAX = 1.5 * 1024 * 1024;   // uploaded frames are stored as-is, so keep them small

const DEFAULT_PIC = "https://raw.githubusercontent.com/bguhm/bguhm.github.io/main/system/images/profile.png";

const PIXEL_BLOCKS = 32;
const PIXEL_OUTPUT  = 300;

let _pixelCache = { src: null, blocks: null, data: null };

function pixelateImageData(srcUrl, blocks = PIXEL_BLOCKS, outSize = PIXEL_OUTPUT) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!srcUrl.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const small = document.createElement("canvas");
        small.width = blocks; small.height = blocks;
        const sctx = small.getContext("2d");
        sctx.imageSmoothingEnabled = true;
        sctx.drawImage(img, 0, 0, blocks, blocks);

        const big = document.createElement("canvas");
        big.width = outSize; big.height = outSize;
        const bctx = big.getContext("2d");
        bctx.imageSmoothingEnabled = false;
        bctx.drawImage(small, 0, 0, blocks, blocks, 0, 0, outSize, outSize);

        resolve(big.toDataURL("image/png"));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = reject;
    img.src = srcUrl;
  });
}

function getPixelatedSrc(srcUrl) {
  if (_pixelCache.src === srcUrl && _pixelCache.blocks === PIXEL_BLOCKS) {
    return Promise.resolve(_pixelCache.data);
  }
  return pixelateImageData(srcUrl).then((data) => {
    _pixelCache = { src: srcUrl, blocks: PIXEL_BLOCKS, data };
    return data;
  });
}

// ── Profile modal ──────────────────────────────────────────────────────
// Three pieces inside #profileOverlay:
//   centre  the card: banner, avatar, display name. "Edit your profile"
//           top-left, a gear menu + close top-right. Save sits BELOW the
//           card and only shows while something has changed.
//   left    #pfpLibrary — profile pictures (Upload pinned first, crop,
//           Remove). Opens from the avatar (pencil on hover) or the gear.
//   right   #bannerLibrary — banners (Upload pinned first, the BannerWS
//           gallery, Remove). Opens from the banner or the gear.
// Every change (picture, banner, pixelate, position, nickname) is PENDING until Save;
// "Advanced editing" (gear menu) is a preference, saved at once: while it's
// on, picking ANY picture or banner in the libraries opens it in the
// cropper first instead of using it as-is.
// closing the modal throws pending changes away.

// ── Banner storage ─────────────────────────────────────────────────────
// Uploads are stored as a data URL under "profileBanner": stills open a
// 4:1 cropper in the banner library (the user picks the strip) and are
// saved at 1200×300 JPEG (keeps localStorage small); a GIF under
// BANNER_GIF_MAX is kept as-is, uncropped, so it stays animated. Banners
// picked from the gallery (BannerWS, served by CUST) are stored as
// "site:<path from the site root>", e.g. "site:assets/media/banners/banner7.jpg",
// so they work from any page and survive a data export.
const BANNER_KEY       = "profileBanner";
const BANNER_W         = 1200;
const BANNER_H         = 300;
const BANNER_GIF_MAX   = 1.5 * 1024 * 1024;
const SITE_ROOT        = new URL("../../", document.currentScript?.src || location.href).href;
const BANNER_SITE      = "site:";
const BANNER_CACHE_KEY = "ws_banner_cache";   // last good BannerWS feed, for an instant/offline library

function bannerUrl(src) {
  if (!src) return "";
  // Gallery banners moved to the mediabaseWS repo (endpoints.js); saved picks
  // and BannerWS rows still say "site:assets/media/banners/…".
  const moved = window.toMediabase(src);
  if (moved !== src) return moved;
  if (src.startsWith(BANNER_SITE)) return new URL(src.slice(BANNER_SITE.length), SITE_ROOT).href;
  return new URL(src, location.href).href;
}

function readBannerFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      if (file.type === "image/gif" && file.size <= BANNER_GIF_MAX) { resolve(reader.result); return; }
      const img = new Image();
      img.onerror = () => reject(new Error("Not an image"));
      img.onload = () => {
        const scale = Math.max(BANNER_W / img.width, BANNER_H / img.height);
        const sw = BANNER_W / scale, sh = BANNER_H / scale;
        const c = document.createElement("canvas");
        c.width = BANNER_W; c.height = BANNER_H;
        c.getContext("2d").drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, BANNER_W, BANNER_H);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// USERNAME vs NICKNAME: the username is the permanent, unique name on the
// access ticket (ticket.js, localStorage ws_username). The nickname is an
// optional display name; with none set, the username is what's shown.
function currentUsername() {
  try { return localStorage.getItem("ws_username") || ""; } catch (_) { return ""; }
}

// ── Saved vs pending ───────────────────────────────────────────────────
// Where the avatar sits on the card: left (default), center or right —
// e.g. centred under a banner that "eats" it. Stored as "pfpAlign".
const PFP_ALIGNS = ["left", "center", "right"];
const PFP_ALIGN_KEY = "pfpAlign";

function savedProfile() {
  const username = currentUsername();
  let nick = localStorage.getItem("nickname") || "";
  if (nick === username) nick = "";
  return {
    pic:       localStorage.getItem("profilePic") || DEFAULT_PIC,
    name:      nick,
    banner:    localStorage.getItem(BANNER_KEY) || "",
    pixelated: localStorage.getItem("pfpPixelated") === "true",
    align:     PFP_ALIGNS.includes(localStorage.getItem(PFP_ALIGN_KEY)) ? localStorage.getItem(PFP_ALIGN_KEY) : "left",
    frame:     localStorage.getItem(FRAME_KEY) || "",
    wrapper:   localStorage.getItem(WRAPPER_KEY) || "",
    wrapperOpacity: localStorage.getItem(WRAPPER_OPACITY_KEY) || "",
  };
}

const _pending = { pic: undefined, name: undefined, banner: undefined, pixelated: undefined, align: undefined, frame: undefined, wrapper: undefined, wrapperOpacity: undefined };

function resetPending() {
  Object.keys(_pending).forEach(k => { _pending[k] = undefined; });
}

function currentValue(key) {
  return _pending[key] !== undefined ? _pending[key] : savedProfile()[key];
}

function profileDirty() {
  const saved = savedProfile();
  return Object.keys(_pending).some(k => _pending[k] !== undefined && _pending[k] !== saved[k]);
}

function setPending(key, value) {
  _pending[key] = value;
  renderProfileCard();
}

// ── Painting ───────────────────────────────────────────────────────────
function paintBanner(src) {
  const el = document.getElementById("profileBanner");
  if (!el) return;
  el.classList.toggle("has-image", !!src);
  // Absolute, because a relative url() inside a custom property resolves
  // against profile.css's folder, not the page (data: URLs pass through).
  if (src) el.style.setProperty("--pf-banner-img", `url("${bannerUrl(src)}")`);
  else el.style.removeProperty("--pf-banner-img");
  // Pixel-art banners (BannerWS "pixelated") stay crisp when stretched.
  const pick = src && src.startsWith(BANNER_SITE) ? cachedBanners().find(b => b.value === src) : null;
  el.style.imageRendering = pick && pick.pixelated ? "pixelated" : "";
}

// Shows a picture in an <img>, pixelated or not.
function paintPic(img, src, pixelated, crisp) {
  if (!img) return;
  img.src = src;
  img.style.imageRendering = "";
  if (!pixelated) return;
  getPixelatedSrc(src).then((dataUrl) => {
    img.src = dataUrl;
    if (crisp) img.style.imageRendering = "pixelated";
  }).catch(() => {});
}

// Shows a frame in an <img> that sits above the picture ("" = none).
function paintFrame(img, src) { window.WSFrames.paint(img, src); }

// The header avatar is a bare <img>; give it a wrapper + a frame layer once.
function headerFrameEl() {
  const pfp = document.getElementById("pfp");
  if (!pfp) return null;
  let wrap = pfp.parentElement;
  if (!wrap || !wrap.classList.contains("pfp-wrap")) {
    wrap = document.createElement("span");
    wrap.className = "pfp-wrap";
    pfp.parentNode.insertBefore(wrap, pfp);
    wrap.appendChild(pfp);
    const f = document.createElement("img");
    f.id = "pfpFrame"; f.className = "pf-frame"; f.alt = ""; f.draggable = false; f.hidden = true;
    wrap.appendChild(f);
  }
  return document.getElementById("pfpFrame");
}

// The modal card, from saved + pending values.
function renderProfileCard() {
  const username = currentUsername();
  const nick     = currentValue("name");
  const pic      = currentValue("pic");
  const pixel    = currentValue("pixelated");

  paintBanner(currentValue("banner"));
  paintPic(document.getElementById("profilePreview"), pic, pixel, true);
  paintFrame(document.getElementById("profileFramePreview"), currentValue("frame"));
  window.WSWrappers.paint(document.getElementById("profileWrapper"), currentValue("wrapper"), currentValue("wrapperOpacity"));
  paintWrapperControls();

  const nameEl   = document.getElementById("profileOverlayUsername");
  const handleEl = document.getElementById("profileOverlayHandle");
  if (nameEl)   nameEl.textContent = nick || username || "Nickname";
  if (handleEl) handleEl.textContent = username ? `@${username}` : "";

  const align = currentValue("align");
  const head = document.querySelector("#profileOverlayPanel .profile-head");
  if (head) head.dataset.align = align;
  document.querySelectorAll("#profileGearMenu [data-align]").forEach(b =>
    b.setAttribute("aria-checked", String(b.dataset.align === align)));

  const pixelBtn = document.getElementById("pixelToggleBtn");
  if (pixelBtn) {
    pixelBtn.setAttribute("aria-checked", String(pixel));
    pixelBtn.querySelector("span").textContent = pixel ? "Un-pixelate picture" : "Pixelate picture";
  }

  paintAdvancedEdit();

  const removePic = document.getElementById("removePicBtn");
  if (removePic) removePic.disabled = pic === DEFAULT_PIC;
  const removeWrapper = document.getElementById("removeWrapperBtn");
  if (removeWrapper) removeWrapper.disabled = !currentValue("wrapper");
  const removeFrame = document.getElementById("removeFrameBtn");
  if (removeFrame) removeFrame.disabled = !currentValue("frame");
  const removeBanner = document.getElementById("removeBannerBtn");
  if (removeBanner) removeBanner.disabled = !currentValue("banner");

  markPicked("#pfpGrid", pic);
  markPicked("#frameGrid", currentValue("frame"));
  markPicked("#wrapperGrid", currentValue("wrapper"));
  markPicked("#bannerGrid", currentValue("banner"));

  const save = document.getElementById("profileSaveBtn");
  if (save) save.hidden = !profileDirty();
}

// The header avatar + dashboard names, from SAVED values only.
function loadProfile() {
  const saved    = savedProfile();
  const username = currentUsername();
  const shown    = saved.name || username || "Nickname";
  const handle   = username && saved.name ? `@${username}` : "";

  const dashNick = document.getElementById("dashNickname");
  const dashUser = document.getElementById("dashUsername");
  if (dashNick) dashNick.textContent = shown;
  if (dashUser) dashUser.textContent = handle;

  const pfpEl = document.getElementById("pfp");
  if (pfpEl) paintPic(pfpEl, saved.pic, saved.pixelated, false);
  paintFrame(headerFrameEl(), saved.frame);

  renderProfileCard();
}

function saveProfile({ pic, name, pixelated, banner, align, frame, wrapper, wrapperOpacity } = {}) {
  try {
    if (wrapper !== undefined) { if (wrapper) localStorage.setItem(WRAPPER_KEY, wrapper); else localStorage.removeItem(WRAPPER_KEY); }
    if (wrapperOpacity !== undefined) { if (wrapperOpacity !== "" && wrapperOpacity !== "100") localStorage.setItem(WRAPPER_OPACITY_KEY, wrapperOpacity); else localStorage.removeItem(WRAPPER_OPACITY_KEY); }
  } catch (_) {}
  if (frame !== undefined) {
    try {
      if (frame) localStorage.setItem(FRAME_KEY, frame);
      else localStorage.removeItem(FRAME_KEY);
    } catch (_) {
      if (typeof showToast === "function") showToast("❌ That frame is too big to save. Try a smaller image.");
    }
  }
  if (align !== undefined && PFP_ALIGNS.includes(align)) localStorage.setItem(PFP_ALIGN_KEY, align);
  if (banner !== undefined) {
    try {
      if (banner) localStorage.setItem(BANNER_KEY, banner);
      else localStorage.removeItem(BANNER_KEY);
    } catch (_) {
      if (typeof showToast === "function") showToast("❌ That banner is too big to save. Try a smaller image.");
    }
  }
  if (pic      !== undefined) localStorage.setItem("profilePic",    pic);
  if (name     !== undefined) localStorage.setItem("nickname",      name);
  if (pixelated !== undefined) localStorage.setItem("pfpPixelated", pixelated ? "true" : "false");
  loadProfile();
}

// ── Advanced editing ───────────────────────────────────────────────────
const ADV_EDIT_KEY = "pfAdvancedEdit";
const advancedEditing = () => { try { return localStorage.getItem(ADV_EDIT_KEY) === "true"; } catch (_) { return false; } };

function paintAdvancedEdit() {
  const on = advancedEditing();
  document.getElementById("profileOverlay")?.classList.toggle("pf-advanced", on);
  const btn = document.getElementById("advancedEditBtn");
  if (btn) btn.setAttribute("aria-checked", String(on));
}

// Set up inside DOMContentLoaded (they need the cropper elements).
let startPicCrop    = null;   // (src) -> opens the 1:1 cropper in the picture library
let startBannerCrop = null;   // (src) -> opens the 4:1 cropper in the banner library

// A tile was picked: use it, or crop it first when advanced editing is on.
function pickPic(src) {
  if (advancedEditing() && startPicCrop) startPicCrop(src);
  else setPending("pic", src);
}
function pickBanner(value) {
  if (advancedEditing() && startBannerCrop) startBannerCrop(bannerUrl(value));
  else setPending("banner", value);
}

// ── Libraries (left: pictures, right: banners) ─────────────────────────
function markPicked(gridSel, value) {
  document.querySelectorAll(`${gridSel} .pf-tile[data-value]`).forEach(t => {
    const on = t.dataset.value === value;
    t.classList.toggle("is-picked", on);
    t.setAttribute("aria-pressed", String(on));
  });
}

function makeTile({ value, img, label, tag, pixelated, upload, onPick, index }) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "pf-tile" + (upload ? " is-upload" : "");
  tile.style.setProperty("--i", index);
  tile.title = label;
  if (value !== undefined) tile.dataset.value = value;
  if (upload) {
    tile.innerHTML = `<span class="pf-tile-upload"><i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i></span><span class="pf-tile-name"></span><span class="pf-tile-pin" aria-hidden="true">1</span>`;
  } else {
    const im = document.createElement("img");
    im.alt = ""; im.loading = "lazy"; im.decoding = "async"; im.src = img;
    if (pixelated) im.style.imageRendering = "pixelated";
    tile.appendChild(im);
    const name = document.createElement("span");
    name.className = "pf-tile-name";
    tile.appendChild(name);
  }
  tile.querySelector(".pf-tile-name").textContent = label;
  if (tag) {
    const t = document.createElement("span");
    t.className = "pf-tile-tag";
    t.textContent = tag;
    tile.appendChild(t);
  }
  tile.addEventListener("click", onPick);
  return tile;
}

function picName(src) {
  const file = decodeURIComponent(String(src).split("/").pop().split(".")[0] || "");
  return file.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^\w/, c => c.toUpperCase()) || "Picture";
}

function renderPfpGrid() {
  const grid = document.getElementById("pfpGrid");
  if (!grid) return;
  const saved = savedProfile().pic;
  const tiles = [makeTile({
    upload: true, label: "Upload", index: 0,
    onPick: () => document.getElementById("profilePicInput")?.click(),
  })];
  // Their own uploaded picture, so switching away and back is one click.
  const own = [saved, _pending.pic].filter((p, i, a) => p && p !== DEFAULT_PIC && !PROFILE_IMAGES.includes(p) && a.indexOf(p) === i);
  own.forEach(src => tiles.push(makeTile({
    value: src, img: src, label: "Yours", index: tiles.length,
    onPick: () => pickPic(src),
  })));
  PROFILE_IMAGES.forEach(src => tiles.push(makeTile({
    value: src, img: src, label: picName(src), index: tiles.length,
    tag: /\.gif($|\?)/i.test(src) ? "GIF" : "",
    onPick: () => pickPic(src),
  })));
  grid.replaceChildren(...tiles);
  markPicked("#pfpGrid", currentValue("pic"));
}

// Frames side modal: Upload, "None", their own upload, then
// every FramesWS frame. Each tile previews the frame over a sample circle.
function frameTile(f, index) {
  const tile = makeTile({
    value: f.url, img: f.url, label: f.name, index,
    tag: f.animated ? "ANIM" : "",
    pixelated: f.pixelated,
    onPick: () => setPending("frame", f.url),
  });
  tile.querySelector("img")?.addEventListener("error", () => tile.classList.add("is-missing"), { once: true });
  return tile;
}

function renderFrameGrid(list, message) {
  const grid = document.getElementById("frameGrid");
  if (!grid) return;
  list = list || window.WSFrames.cached();
  const saved = savedProfile().frame;
  const tiles = [makeTile({
    upload: true, label: "Upload", index: 0,
    onPick: () => document.getElementById("profileFrameInput")?.click(),
  })];
  const none = makeTile({ value: "", img: "", label: "None", index: tiles.length, onPick: () => setPending("frame", "") });
  none.querySelector("img")?.remove();
  none.classList.add("is-none");
  none.insertAdjacentHTML("afterbegin", `<span class="pf-tile-upload"><i class="fa-solid fa-ban" aria-hidden="true"></i></span>`);
  tiles.push(none);
  const own = [saved, _pending.frame].filter((f, i, a) => f && f.startsWith("data:") && a.indexOf(f) === i);
  own.forEach(src => tiles.push(makeTile({ value: src, img: src, label: "Yours", index: tiles.length, onPick: () => setPending("frame", src) })));
  list.forEach(f => tiles.push(frameTile(f, tiles.length)));
  if (message) {
    const p = document.createElement("p");
    p.className = "pf-library-msg";
    p.textContent = message;
    tiles.push(p);
  }
  grid.replaceChildren(...tiles);
  markPicked("#frameGrid", currentValue("frame"));
}

// Shows the cached list at once, then swaps in the live one.
function loadFrameGrid() {
  const cached = window.WSFrames.cached();
  renderFrameGrid(cached, cached.length ? "" : "Loading frames…");
  window.WSFrames.load()
    .then(list => { renderFrameGrid(list, list.length ? "" : "No frames yet. Check back soon!"); renderProfileCard(); })
    .catch(() => { if (!window.WSFrames.cached().length) renderFrameGrid([], "Couldn't load frames right now. Try again in a bit."); });
}

// Card wrapper dock (under the card): "None" + every WrapperWS wrapper, shown as thumbnails.
function wrapperTile(w, index) {
  const tile = makeTile({
    value: w.url, img: w.url, label: w.name, index,
    tag: w.animated ? "ANIM" : "",
    pixelated: w.pixelated,
    onPick: () => setPending("wrapper", w.url),
  });
  tile.querySelector("img")?.addEventListener("error", () => tile.classList.add("is-missing"), { once: true });
  return tile;
}

function renderWrapperGrid(list, message) {
  const grid = document.getElementById("wrapperGrid");
  if (!grid) return;
  list = list || window.WSWrappers.cached();
  const none = makeTile({ value: "", img: "", label: "None", index: 0, onPick: () => setPending("wrapper", "") });
  none.querySelector("img")?.remove();
  none.classList.add("is-none");
  none.insertAdjacentHTML("afterbegin", `<span class="pf-tile-upload"><i class="fa-solid fa-ban" aria-hidden="true"></i></span>`);
  const tiles = [none];
  list.forEach(w => tiles.push(wrapperTile(w, tiles.length)));
  if (message) {
    const p = document.createElement("p");
    p.className = "pf-library-msg";
    p.textContent = message;
    tiles.push(p);
  }
  grid.replaceChildren(...tiles);
  markPicked("#wrapperGrid", currentValue("wrapper"));
}

function loadWrapperGrid() {
  const cached = window.WSWrappers.cached();
  renderWrapperGrid(cached, cached.length ? "" : "Loading wrappers…");
  window.WSWrappers.load()
    .then(list => { renderWrapperGrid(list, list.length ? "" : "No wrappers yet. Check back soon!"); renderProfileCard(); })
    .catch(() => { if (!window.WSWrappers.cached().length) renderWrapperGrid([], "Couldn't load wrappers right now. Try again in a bit."); });
}

// The wrapper opacity slider (gear menu): a user setting, so it stays usable
// with or without a wrapper picked.
function paintWrapperControls() {
  const slider = document.getElementById("wrapperOpacity");
  const out    = document.getElementById("wrapperOpacityVal");
  if (!slider) return;
  const pct = window.WSWrappers.opacityPct(currentValue("wrapperOpacity"));
  if (String(slider.value) !== String(pct)) slider.value = String(pct);
  if (out) out.textContent = `${pct}%`;
}

// BannerWS columns: name | identification | type | src | thumb | animated | pixelated
// (src/thumb are paths from the site root; type "soon" hides a row).
function parseBanners(rows) {
  if (!Array.isArray(rows)) throw new Error((rows && rows.error) || "Banner feed did not return a list.");
  const yes = (v) => /^(true|yes|1)$/i.test(String(v || "").trim());
  return rows
    .map(r => ({
      id:        String(r.identification || r.id || "").trim(),
      name:      String(r.name || "").trim(),
      type:      String(r.type || "").trim().toLowerCase(),
      src:       String(r.src || "").trim().replace(/^\/+/, ""),
      thumb:     String(r.thumb || "").trim().replace(/^\/+/, ""),
      animated:  yes(r.animated),
      pixelated: yes(r.pixelated),
    }))
    .filter(b => b.id && b.src && b.type !== "soon")
    .map(b => ({ ...b, value: BANNER_SITE + b.src }));
}

function cachedBanners() {
  try { const v = JSON.parse(localStorage.getItem(BANNER_CACHE_KEY) || "[]"); return Array.isArray(v) ? v : []; }
  catch (_) { return []; }
}

let _bannerFetch = null;
function loadBanners() {
  if (_bannerFetch) return _bannerFetch;
  _bannerFetch = (typeof ticketReady === "function" ? ticketReady() : Promise.resolve())
    .then(() => fetch(bustCache(`${window.WS_ENDPOINTS.cust}?type=banners`), { cache: "no-store" }))
    .then(r => r.json())
    .then(rows => {
      const list = parseBanners(rows);
      try { localStorage.setItem(BANNER_CACHE_KEY, JSON.stringify(list)); } catch (_) {}
      return list;
    })
    .catch(err => {
      _bannerFetch = null;              // try again next time the library opens
      const cached = cachedBanners();
      if (cached.length) return cached;
      throw err;
    });
  return _bannerFetch;
}

function renderBannerGrid(list, message) {
  const grid = document.getElementById("bannerGrid");
  if (!grid) return;
  const tiles = [makeTile({
    upload: true, label: "Upload", index: 0,
    onPick: () => document.getElementById("profileBannerInput")?.click(),
  })];
  const saved = savedProfile().banner;
  // An uploaded (data URL) banner, so it can be picked again.
  [saved, _pending.banner].filter((b, i, a) => b && !b.startsWith(BANNER_SITE) && a.indexOf(b) === i)
    .forEach(src => tiles.push(makeTile({ value: src, img: bannerUrl(src), label: "Yours", index: tiles.length, onPick: () => pickBanner(src) })));
  list.forEach(b => tiles.push(makeTile({
    value: b.value, img: bannerUrl(BANNER_SITE + (b.thumb || b.src)), label: b.name || b.id,
    tag: b.animated ? "GIF" : "", pixelated: b.pixelated, index: tiles.length,
    onPick: () => pickBanner(b.value),
  })));
  if (message) {
    const p = document.createElement("p");
    p.className = "pf-library-msg";
    p.textContent = message;
    tiles.push(p);
  }
  grid.replaceChildren(...tiles);
  markPicked("#bannerGrid", currentValue("banner"));
}

// Side modals / docks: pfp + frames (left, frames laid on top), banner (right),
// wrappers (docked under the centred card).
const LIBRARY_IDS = { pfp: "pfpLibrary", frames: "framesLibrary", banner: "bannerLibrary", wrappers: "wrapperLibrary" };
function libraryEl(which) { return document.getElementById(LIBRARY_IDS[which] || LIBRARY_IDS.pfp); }
function closeAllLibraries() {
  return Object.keys(LIBRARY_IDS).map(closeLibrary).some(Boolean);   // map first: every one closes
}

function openLibrary(which) {
  const lib = libraryEl(which);
  if (!lib) return;
  lib.hidden = false;
  if (which === "banner") {
    const cached = cachedBanners();
    renderBannerGrid(cached, cached.length ? "" : "Loading banners…");
    loadBanners().then(list => renderBannerGrid(list))
      .catch(() => { if (!cachedBanners().length) renderBannerGrid([], "Couldn't load banners right now. Try again in a bit."); });
  } else if (which === "frames") {
    loadFrameGrid();
  } else if (which === "wrappers") {
    loadWrapperGrid();
  } else {
    renderPfpGrid();
  }
  lib.querySelector(".pf-tile")?.focus({ preventScroll: true });
}

function closeLibrary(which) {
  const lib = libraryEl(which);
  if (!lib || lib.hidden) return false;
  lib.hidden = true;
  document.getElementById("profileOverlayTitle")?.setAttribute("aria-expanded", "false");
  return true;
}

// ── Gear menu ──────────────────────────────────────────────────────────
function setGearMenu(open) {
  const menu = document.getElementById("profileGearMenu");
  const btn  = document.getElementById("profileGearBtn");
  if (!menu) return false;
  const was = !menu.hidden;
  menu.hidden = !open;
  btn?.setAttribute("aria-expanded", String(open));
  if (open) menu.querySelector("button")?.focus({ preventScroll: true });
  return was;
}

// ── Inline nickname editing ────────────────────────────────────────────
function nameEditing() {
  const input = document.getElementById("usernameInput");
  return !!input && !input.hidden;
}

function startNameEdit() {
  const input = document.getElementById("usernameInput");
  const shown = document.getElementById("profileOverlayUsername");
  const btn   = document.getElementById("editNameBtn");
  if (!input || !shown) return;
  const username = currentUsername();
  input.placeholder = username ? `Blank shows @${username}` : "What should we call you?";
  input.value = currentValue("name");
  shown.hidden = true;
  input.hidden = false;
  btn?.classList.add("is-editing");
  btn?.setAttribute("aria-label", "Done editing nickname");
  if (btn) btn.innerHTML = `<i class="fa-solid fa-check" aria-hidden="true"></i>`;
  input.focus();
  input.select();
}

// commit=false throws the typed value away.
function endNameEdit(commit) {
  const input = document.getElementById("usernameInput");
  const shown = document.getElementById("profileOverlayUsername");
  const btn   = document.getElementById("editNameBtn");
  if (!nameEditing()) return true;
  if (commit) {
    const value = input.value.trim();
    // Same word list as the tutorial (wordfilter.js).
    if (value && window.WS_WordFilter?.find(value)) {
      if (typeof showToast === "function") showToast("❌ That nickname isn't allowed. Try another one.");
      input.focus();
      return false;
    }
    if (!value && !currentUsername()) {
      if (typeof showToast === "function") showToast("Pick a nickname first.");
      input.focus();
      return false;
    }
    _pending.name = value;
  }
  input.hidden = true;
  shown.hidden = false;
  btn?.classList.remove("is-editing");
  btn?.setAttribute("aria-label", "Edit nickname");
  if (btn) btn.innerHTML = `<i class="fa-solid fa-pencil" aria-hidden="true"></i>`;
  renderProfileCard();
  return true;
}

// ── Open / close ───────────────────────────────────────────────────────
function openProfileOverlay() {
  window.WS_WordFilter?.load();
  resetPending();
  loadProfile();
  const overlay = document.getElementById("profileOverlay");
  if (!overlay) return;
  overlay.classList.add("visible");
  document.getElementById("profileOverlayPanel")?.focus({ preventScroll: true });
}

function closeProfileOverlay() {
  const overlay = document.getElementById("profileOverlay");
  if (!overlay || !overlay.classList.contains("visible")) return;
  if (nameEditing()) endNameEdit(false);
  const dropped = profileDirty();
  setGearMenu(false);
  closeAllLibraries();
  document.getElementById("cropCancel")?.click();
  document.getElementById("bannerCropCancel")?.click();
  resetPending();
  overlay.classList.remove("visible");
  loadProfile();
  if (dropped && typeof showToast === "function") showToast("Unsaved profile changes were discarded.");
}

window.openProfileOverlay  = openProfileOverlay;
window.closeProfileOverlay = closeProfileOverlay;

window.addEventListener("DOMContentLoaded", () => {
  loadProfile();
  document.addEventListener("ws:ticket-change", loadProfile);
  const $id = (id) => document.getElementById(id);

  // Header avatar opens the modal.
  const pfpEl = $id("pfp");
  if (pfpEl) {
    pfpEl.style.cursor = "pointer";
    pfpEl.addEventListener("click", (e) => { e.preventDefault(); openProfileOverlay(); });
    const parent = pfpEl.closest("a");
    if (parent) {
      parent.removeAttribute("href");
      parent.style.cursor = "default";
      parent.style.pointerEvents = "none";
      pfpEl.style.pointerEvents = "auto";
    }
  }

  const overlay = $id("profileOverlay");
  if (!overlay) return;

  $id("profileOverlayClose")?.addEventListener("click", closeProfileOverlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeProfileOverlay(); });

  // Esc closes the innermost thing first: name edit, gear menu, libraries,
  // then the modal. Capture phase so it never fires the panic redirect, and
  // typing in the modal never triggers the page's hotkeys.
  document.addEventListener("keydown", (e) => {
    if (!overlay.classList.contains("visible")) return;
    if (e.key === "Escape") {
      e.preventDefault(); e.stopImmediatePropagation();
      if (nameEditing()) { endNameEdit(false); $id("editNameBtn")?.focus(); return; }
      if (setGearMenu(false)) { $id("profileGearBtn")?.focus(); return; }
      if (closeAllLibraries()) { $id("profileOverlayPanel")?.focus({ preventScroll: true }); return; }
      closeProfileOverlay();
      return;
    }
    if (!overlay.contains(e.target)) return;
    // Handled here because the line below stops the event before it
    // reaches the input's own listeners.
    if (e.key === "Enter" && e.target.id === "usernameInput") {
      e.preventDefault();
      if (endNameEdit(true)) $id("editNameBtn")?.focus();
    }
    e.stopImmediatePropagation();
  }, true);

  // Gear menu
  $id("profileGearBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    setGearMenu($id("profileGearMenu").hidden);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest?.(".pf-gear-wrap")) setGearMenu(false);
  });
  $id("profileGearMenu")?.addEventListener("click", (e) => {
    const item = e.target.closest("button");
    if (!item) return;
    if (item.dataset.openLibrary) { setGearMenu(false); openLibrary(item.dataset.openLibrary); }
    if (item.id === "pixelToggleBtn") setPending("pixelated", !currentValue("pixelated"));
    if (item.id === "advancedEditBtn") {
      const on = !advancedEditing();
      try { localStorage.setItem(ADV_EDIT_KEY, String(on)); } catch (_) {}
      paintAdvancedEdit();
      if (typeof showToast === "function") {
        showToast(on ? "Advanced editing on: pick any picture or banner to crop it." : "Advanced editing off.");
      }
    }
    if (item.dataset.align) setPending("align", item.dataset.align);
  });

  // Libraries open from the avatar / the banner too.
  $id("profileAvatarBtn")?.addEventListener("click", () => openLibrary("pfp"));
  const banner = $id("profileBanner");
  banner?.addEventListener("click", () => openLibrary("banner"));
  banner?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    openLibrary("banner");
  });
  overlay.querySelectorAll("[data-close-library]").forEach(btn =>
    btn.addEventListener("click", () => closeLibrary(btn.dataset.closeLibrary)));

  // "Edit your profile" opens both libraries (or closes both if they're open).
  $id("profileOverlayTitle")?.addEventListener("click", (e) => {
    const bothOpen = !libraryEl("pfp").hidden && !libraryEl("banner").hidden;
    if (bothOpen) { closeAllLibraries(); }
    else { openLibrary("banner"); openLibrary("pfp"); }
    e.currentTarget.setAttribute("aria-expanded", String(!bothOpen));
  });

  $id("removePicBtn")?.addEventListener("click", () => setPending("pic", DEFAULT_PIC));
  $id("removeFrameBtn")?.addEventListener("click", () => setPending("frame", ""));
  $id("removeWrapperBtn")?.addEventListener("click", () => setPending("wrapper", ""));
  $id("wrapperOpacity")?.addEventListener("input", (e) => setPending("wrapperOpacity", String(e.target.value)));

  // Frame upload: kept as-is (no crop) so transparency and GIFs survive.
  $id("profileFrameInput")?.addEventListener("change", (e) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!/^image\/(png|webp|gif|apng)$/.test(file.type)) {
      if (typeof showToast === "function") showToast("❌ Frames need transparency: use a PNG, WebP or GIF.");
      return;
    }
    if (file.size > FRAME_GIF_MAX) {
      if (typeof showToast === "function") showToast("❌ That frame is over 1.5 MB. Try a smaller one.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => { if (typeof showToast === "function") showToast("❌ That file couldn't be read."); };
    reader.onload = () => { setPending("frame", reader.result); renderFrameGrid(); };
    reader.readAsDataURL(file);
  });
  $id("removeBannerBtn")?.addEventListener("click", () => setPending("banner", ""));

  // Nickname: pencil -> inline input -> Enter / ✓ / click away keeps it.
  const nameInput = $id("usernameInput");
  const editBtn   = $id("editNameBtn");
  editBtn?.addEventListener("pointerdown", (e) => { if (nameEditing()) e.preventDefault(); }); // keep focus so blur doesn't commit twice
  editBtn?.addEventListener("click", () => (nameEditing() ? endNameEdit(true) : startNameEdit()));
  nameInput?.addEventListener("blur", () => { if (nameEditing()) endNameEdit(true); });

  // Banner upload (pinned "Upload" tile in the banner library). Stills open
  // a 4:1 cropper in the library; small GIFs skip it so they stay animated.
  const bannerInput     = $id("profileBannerInput");
  const bannerCropBox   = $id("bannerCropContainer");
  const bannerCropImg   = $id("bannerCropPreview");
  const bannerGrid      = $id("bannerGrid");
  let bannerCropper = null;
  const showBannerCrop = (on) => {
    if (bannerCropBox) bannerCropBox.style.display = on ? "block" : "none";
    if (bannerGrid) bannerGrid.hidden = on;
  };
  const endBannerCrop = () => {
    if (bannerCropper) { bannerCropper.destroy(); bannerCropper = null; }
    showBannerCrop(false);
  };

  bannerInput?.addEventListener("change", () => {
    const file = bannerInput.files?.[0];
    bannerInput.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      if (typeof showToast === "function") showToast("❌ That file isn't an image.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => { if (typeof showToast === "function") showToast("❌ That file couldn't be read as an image."); };
    reader.onload = () => {
      if (file.type === "image/gif" && file.size <= BANNER_GIF_MAX) {
        setPending("banner", reader.result);
        if (!libraryEl("banner").hidden) openLibrary("banner");   // show it as "Yours"
        if (typeof showToast === "function") showToast("GIF banners stay animated, so they're used uncropped.");
        return;
      }
      if (typeof Cropper === "undefined" || !bannerCropImg) {
        // No cropper available: fall back to the automatic centre crop.
        readBannerFile(file).then(data => setPending("banner", data)).catch(() => {});
        return;
      }
      startBannerCrop(reader.result);
    };
    reader.readAsDataURL(file);
  });

  // Opens the 4:1 cropper on any banner: an upload or a gallery one. A GIF
  // comes out as a still (that's what cropping does to it).
  startBannerCrop = (src) => {
    if (!bannerCropImg || typeof Cropper === "undefined") return;
    libraryEl("banner").hidden = false;
    showBannerCrop(true);
    if (bannerCropper) bannerCropper.destroy();
    bannerCropImg.src = src;
    bannerCropper = new Cropper(bannerCropImg, {
      aspectRatio: BANNER_W / BANNER_H, viewMode: 1, autoCropArea: 1,
      background: false, dragMode: "move", checkCrossOrigin: true,
    });
    if (/\.gif($|\?)/i.test(src) && typeof showToast === "function") {
      showToast("Heads up: a cropped GIF banner becomes a still image.");
    }
  };

  $id("bannerCropConfirm")?.addEventListener("click", () => {
    if (!bannerCropper) return;
    const data = bannerCropper.getCroppedCanvas({ width: BANNER_W, height: BANNER_H, fillColor: "#000" }).toDataURL("image/jpeg", 0.85);
    endBannerCrop();
    setPending("banner", data);
    openLibrary("banner");   // re-render so it shows as "Yours"
  });
  $id("bannerCropCancel")?.addEventListener("click", endBannerCrop);

  // Picture upload + crop, inside the picture library.
  let cropper = null;
  const fileInput      = $id("profilePicInput");
  const cropContainer  = $id("cropContainer");
  const cropPreviewImg = $id("cropPreview");
  const pfpGrid        = $id("pfpGrid");
  const showCrop = (on) => {
    if (cropContainer) cropContainer.style.display = on ? "block" : "none";
    if (pfpGrid) pfpGrid.hidden = on;
  };

  // Opens the 1:1 cropper on any picture: an upload (data URL) or one of
  // the library's own (a URL; Cropper loads it with CORS so it can be
  // cut out — if a host refuses, the crop falls back to using it as-is).
  startPicCrop = (src) => {
    if (!cropPreviewImg || typeof Cropper === "undefined") { setPending("pic", src); return; }
    libraryEl("pfp").hidden = false;
    showCrop(true);
    if (cropper) cropper.destroy();
    cropPreviewImg.src = src;
    cropper = new Cropper(cropPreviewImg, { aspectRatio: 1, viewMode: 1, background: false, dragMode: "move", checkCrossOrigin: true });
    cropper.__src = src;
  };

  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => startPicCrop(ev.target.result);
    reader.readAsDataURL(file);
  });

  $id("cropConfirm")?.addEventListener("click", () => {
    if (!cropper) return;
    let data;
    try {
      data = cropper.getCroppedCanvas({ width: 300, height: 300 }).toDataURL("image/png");
    } catch (_) {
      // That host doesn't allow its images to be cut out: use it whole.
      data = cropper.__src;
      if (typeof showToast === "function") showToast("That picture can't be cropped (its host blocks it), so it's used as-is.");
    }
    cropper.destroy();
    cropper = null;
    showCrop(false);
    if (fileInput) fileInput.value = "";
    setPending("pic", data);
    renderPfpGrid();
  });

  $id("cropCancel")?.addEventListener("click", () => {
    if (cropper) { cropper.destroy(); cropper = null; }
    showCrop(false);
    if (fileInput) fileInput.value = "";
  });

  // Save (below the card; only visible while something changed).
  $id("profileSaveBtn")?.addEventListener("click", () => {
    if (nameEditing() && !endNameEdit(true)) return;
    const name = _pending.name;
    if (name && window.WS_WordFilter?.find(name)) {
      if (typeof showToast === "function") showToast("❌ That nickname isn't allowed. Try another one.");
      startNameEdit();
      return;
    }
    saveProfile({
      pic:       _pending.pic,
      // Empty nickname = show the username (only if there is one to fall
      // back on; otherwise keep the old nickname).
      name:      name === undefined ? undefined : (name || (currentUsername() ? "" : undefined)),
      pixelated: _pending.pixelated,
      banner:    _pending.banner,
      align:     _pending.align,
      frame:     _pending.frame,
      wrapper:   _pending.wrapper,
      wrapperOpacity: _pending.wrapperOpacity,
    });
    resetPending();
    if (typeof showToast === "function") showToast("✅ Profile saved.");
    closeProfileOverlay();
  });
});
