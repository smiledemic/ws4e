"use strict";

// ── Widgets ────────────────────────────────────────────────────────────
// One floating bubble (#wsWidgetBubble) that opens a panel with the
// current widget in an iframe. The widgets picked in the store are a
// carousel: + / - swap which one the bubble holds (the others keep
// running off-screen, so swapping back is instant). \ hides / shows all
// of it without closing anything.
//
// Bubble: click (or Enter/Space) opens → minimizes → opens again; drag it
// anywhere. Panel: ⛶ fullscreen, − minimize, ✕ close (unloads the widget),
// and a corner handle to resize.
//
// Pointer handling uses pointer capture, so a drag or resize always ends,
// even if the button is released over the widget's iframe (which would
// otherwise swallow the release and leave the bubble "stuck" dragging),
// and a press only becomes a drag after DRAG_SLOP px, so a slightly
// wobbly click still counts as a click.
//
// Saved per browser:
//   ws_selected_widgets  the store's picks, in order          (store.html)
//   ws_active_widget     which pick the bubble currently holds
//   ws_widgets_hidden    "true" while \ has hidden them
//   ws_widget_cache      the last widget list from the server, so the
//                        bubble shows straight away on the next load
//                        (refreshed from the server every load)
(() => {
  const SHEETS_URL    = `${window.WS_ENDPOINTS.cust}?type=widgets`; // endpoints.js
  const SELECTION_KEY = "ws_selected_widgets";
  const ACTIVE_KEY    = "ws_active_widget";
  const HIDDEN_KEY    = "ws_widgets_hidden";
  const CACHE_KEY     = "ws_widget_cache";

  const ICON_CLOSE = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><line x1='18' y1='6' x2='6' y2='18' stroke='white' stroke-width='2.5' stroke-linecap='round'/><line x1='6' y1='6' x2='18' y2='18' stroke='white' stroke-width='2.5' stroke-linecap='round'/></svg>";

  const GAP        = 12;   // bubble ↔ panel
  const DRAG_SLOP  = 5;    // px a press has to move before it's a drag
  const MIN_W = 260, MIN_H = 320;

  const bubble       = document.getElementById("wsWidgetBubble");
  const panel        = document.getElementById("wsWidgetPanel");
  const frameWrap    = document.getElementById("wsWidgetFrameWrap");
  const closeBtn     = document.getElementById("wsWidgetCloseBtn");
  const minBtn       = document.getElementById("wsWidgetMinBtn");
  const fsBtn        = document.getElementById("wsWidgetFsBtn");
  const resizeHandle = document.getElementById("wsWidgetResizeHandle");
  const icon         = document.getElementById("wsWidgetIcon");

  if (!bubble || !panel || !frameWrap) return;

  const readJSON = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? fallback; } catch (_) { return fallback; } };
  const write    = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const toast    = (msg) => { if (typeof showToast === "function") showToast(msg); };

  // Hidden staging area for widgets' iframes that aren't currently shown:
  // a swapped-away widget keeps running here instead of reloading.
  const keepAlive = document.createElement("div");
  keepAlive.style.cssText = "position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;";
  document.body.appendChild(keepAlive);

  let carousel     = [];        // configs of the picked widgets, in pick order
  let currentIndex = -1;        // which one the bubble holds
  let state        = "closed";  // closed | open | minimized
  let isFullscreen = false;
  let savedStyle   = {};
  const iframeCache = new Map(); // widget id → its iframe

  const currentCfg = () => (currentIndex >= 0 ? carousel[currentIndex] : null);

  // ── Look ─────────────────────────────────────────────────────────────
  function shadow2From(sh) {
    const m = sh.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/i);
    return m ? `rgba(${m[1]},${m[2]},${m[3]},0.3)` : sh;
  }

  function paintBubble() {
    const cfg = currentCfg();
    if (!cfg) return;
    const root = document.documentElement;
    const bg = cfg["background-color"] || "#ff5a00";
    const sh = cfg["shadow-color"]     || "rgba(255,90,0,0.65)";
    root.style.setProperty("--ws-widget-bg",      bg);
    root.style.setProperty("--ws-widget-shadow1", sh);
    root.style.setProperty("--ws-widget-shadow2", shadow2From(sh));
    const name = cfg["widget-name"] || cfg.id;
    bubble.setAttribute("aria-label", state === "open" ? `Minimize ${name}` : `Open ${name}`);
    bubble.setAttribute("aria-expanded", String(state === "open"));
    icon.src = state === "open" ? ICON_CLOSE : (cfg["widget-icon"] || "");
  }

  // ── Iframes ──────────────────────────────────────────────────────────
  function iframeFor(cfg) {
    let el = iframeCache.get(cfg.id);
    if (!el) {
      el = document.createElement("iframe");
      el.className = "ws-widget-iframe";
      el.src       = cfg["widget-url"] || "";
      el.loading   = "eager";
      el.allow     = "fullscreen; autoplay";
      el.title     = cfg["widget-name"] || cfg.id;
      iframeCache.set(cfg.id, el);
    }
    return el;
  }

  // Shows the current widget's iframe in the panel; whatever was there is
  // parked in keepAlive, still running.
  function mountCurrent() {
    const cfg = currentCfg();
    if (!cfg) return;
    const el = iframeFor(cfg);
    const showing = frameWrap.firstElementChild;
    if (showing && showing !== el) keepAlive.appendChild(showing);
    if (el.parentElement !== frameWrap) frameWrap.appendChild(el);
  }

  function unloadCurrent() {
    const cfg = currentCfg();
    const el = cfg && iframeCache.get(cfg.id);
    if (!el) return;
    el.src = "about:blank";
    el.remove();
    iframeCache.delete(cfg.id);
  }

  function iframePointers(on) {
    const el = frameWrap.firstElementChild;
    if (el) el.style.pointerEvents = on ? "" : "none";
  }

  // Clicking into a widget moves keyboard focus into its iframe, where the
  // page's keys (\ + -) can't hear anything. Hand focus back to the page
  // whenever the widget goes away.
  function reclaimFocus() {
    const a = document.activeElement;
    if (a && a.tagName === "IFRAME" && (panel.contains(a) || keepAlive.contains(a))) {
      a.blur();
      bubble.focus({ preventScroll: true });
    }
  }

  // ── State ────────────────────────────────────────────────────────────
  function setState(next) {
    if (next !== "open" && isFullscreen) exitFullscreen(false);
    if (next === "open") {
      if (!currentCfg()) return;
      mountCurrent();
    }
    const wasOpen = state === "open";
    state = next;
    panel.style.display = state === "open" ? "flex" : "none";
    if (state === "closed") unloadCurrent();
    if (wasOpen && state !== "open") reclaimFocus();
    paintBubble();
    if (state === "open") requestAnimationFrame(positionPanel);
  }

  const toggleFromBubble = () => setState(state === "open" ? "minimized" : "open");

  function positionPanel() {
    if (state !== "open" || isFullscreen) return;
    const b  = bubble.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    const onLeft = b.left + b.width / 2 < vw / 2;
    const top  = Math.max(8, Math.min(b.top + b.height / 2 - ph / 2, vh - ph - 8));
    const left = onLeft
      ? Math.min(b.right + GAP, vw - pw - 8)
      : Math.max(8, b.left - pw - GAP);
    Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" });
    if (resizeHandle) resizeHandle.dataset.side = onLeft ? "right" : "left";
  }

  // ── Fullscreen (with a mirror of the buttons that the widget can't cover) ──
  const btnsOverlay = document.createElement("div");
  btnsOverlay.className = "ws-widget-fs-btns";
  Object.assign(btnsOverlay.style, {
    position: "fixed", top: "10px", right: "10px",
    display: "none", gap: "5px", zIndex: "2147483647",
    pointerEvents: "none", transition: "opacity .25s,transform .25s",
    opacity: "0", transform: "translateY(-6px)", flexDirection: "row",
  });
  [fsBtn, minBtn, closeBtn].filter(Boolean).forEach((orig) => {
    const clone = orig.cloneNode(true);
    clone.removeAttribute("id");
    clone.dataset.mirrorOf = orig.id;
    clone.addEventListener("click", (e) => { e.stopPropagation(); orig.click(); });
    btnsOverlay.appendChild(clone);
  });
  document.body.appendChild(btnsOverlay);

  let overlayTimer = 0;
  function syncOverlay() {
    btnsOverlay.querySelectorAll("[data-mirror-of]").forEach((clone) => {
      const orig = document.getElementById(clone.dataset.mirrorOf);
      clone.textContent = orig.textContent;
      clone.title = orig.title;
    });
  }
  function showOverlay() {
    clearTimeout(overlayTimer);
    Object.assign(btnsOverlay.style, { display: "flex", opacity: "1", transform: "translateY(0)", pointerEvents: "all" });
  }
  function hideOverlay() {
    Object.assign(btnsOverlay.style, { opacity: "0", transform: "translateY(-6px)", pointerEvents: "none" });
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => { btnsOverlay.style.display = "none"; }, 260);
  }

  function enterFullscreen() {
    savedStyle = {};
    for (const p of ["width", "height", "top", "left", "right", "bottom"]) savedStyle[p] = panel.style[p] || "";
    panel.classList.add("ss-fullscreen");
    isFullscreen = true;
    fsBtn.textContent = "⊠"; fsBtn.title = "Exit Fullscreen";
    syncOverlay(); showOverlay();
    document.body.style.overflow = "hidden";
  }
  function exitFullscreen(reposition = true) {
    if (!isFullscreen) return;
    panel.classList.remove("ss-fullscreen");
    Object.assign(panel.style, savedStyle);
    isFullscreen = false;
    fsBtn.textContent = "⛶"; fsBtn.title = "Fullscreen";
    syncOverlay(); hideOverlay();
    document.body.style.overflow = "";
    if (reposition) requestAnimationFrame(positionPanel);
  }

  document.addEventListener("mousemove", (e) => {
    if (!isFullscreen) return;
    if (e.clientY < 60) showOverlay();
    else if (btnsOverlay.style.opacity === "1") hideOverlay();
  });

  fsBtn?.addEventListener("click",    (e) => { e.stopPropagation(); if (state === "open") (isFullscreen ? exitFullscreen() : enterFullscreen()); });
  minBtn?.addEventListener("click",   (e) => { e.stopPropagation(); setState("minimized"); });
  closeBtn?.addEventListener("click", (e) => { e.stopPropagation(); setState("closed"); });

  // ── Bubble: click vs drag ────────────────────────────────────────────
  bubble.style.touchAction = "none";   // a touch drag moves the bubble, not the page
  let press = null;                    // { id, x, y, offX, offY, dragging }
  let swallowClick = false;            // the click that ends a drag isn't a click

  bubble.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = bubble.getBoundingClientRect();
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, dragging: false };
    try { bubble.setPointerCapture(e.pointerId); } catch (_) {}
  });

  bubble.addEventListener("pointermove", (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.dragging) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_SLOP) return;
      press.dragging = true;
      iframePointers(false);
      bubble.style.right = "auto";
      bubble.style.bottom = "auto";
    }
    const x = Math.max(0, Math.min(e.clientX - press.offX, window.innerWidth  - bubble.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - press.offY, window.innerHeight - bubble.offsetHeight));
    bubble.style.left = `${x}px`;
    bubble.style.top  = `${y}px`;
    positionPanel();
  });

  function endPress(e) {
    if (!press || (e && e.pointerId !== press.id)) return;
    if (press.dragging) {
      // The click this release produces comes right after; skip only that
      // one, never a later real click.
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
      iframePointers(true);
    }
    try { bubble.releasePointerCapture(press.id); } catch (_) {}
    press = null;
  }
  bubble.addEventListener("pointerup", endPress);
  bubble.addEventListener("pointercancel", endPress);
  bubble.addEventListener("lostpointercapture", endPress);

  // Mouse, touch and keyboard (Enter/Space on the focused bubble) all land
  // here; only a finished drag is skipped.
  bubble.addEventListener("click", (e) => {
    if (swallowClick) { swallowClick = false; e.preventDefault(); return; }
    toggleFromBubble();
  });

  // ── Resize handle ────────────────────────────────────────────────────
  let resize = null;
  resizeHandle?.addEventListener("pointerdown", (e) => {
    if (isFullscreen || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p = panel.getBoundingClientRect();
    resize = { id: e.pointerId, x: e.clientX, y: e.clientY, w: panel.offsetWidth, h: panel.offsetHeight, left: p.left, onLeft: resizeHandle.dataset.side === "left" };
    iframePointers(false);
    try { resizeHandle.setPointerCapture(e.pointerId); } catch (_) {}
  });
  resizeHandle?.addEventListener("pointermove", (e) => {
    if (!resize || e.pointerId !== resize.id) return;
    const dx = e.clientX - resize.x, dy = e.clientY - resize.y;
    panel.style.height = `${Math.max(MIN_H, Math.min(resize.h + dy, window.innerHeight * 0.85))}px`;
    if (resize.onLeft) {
      const w = Math.max(MIN_W, Math.min(resize.w - dx, window.innerWidth * 0.9));
      panel.style.width = `${w}px`;
      panel.style.left  = `${Math.max(8, resize.left + resize.w - w)}px`;
    } else {
      panel.style.width = `${Math.max(MIN_W, Math.min(resize.w + dx, window.innerWidth * 0.9))}px`;
    }
  });
  const endResize = (e) => {
    if (!resize || (e && e.pointerId !== resize.id)) return;
    try { resizeHandle.releasePointerCapture(resize.id); } catch (_) {}
    resize = null;
    iframePointers(true);
  };
  resizeHandle?.addEventListener("pointerup", endResize);
  resizeHandle?.addEventListener("pointercancel", endResize);
  resizeHandle?.addEventListener("lostpointercapture", endResize);

  panel.addEventListener("wheel", (e) => { e.stopPropagation(); }, { passive: true });
  window.addEventListener("resize", () => positionPanel());

  // ── Carousel (+ / -) ─────────────────────────────────────────────────
  function showCarouselHint() {
    const cfg = currentCfg();
    if (!cfg) return;
    let hint = document.getElementById("wsCarouselHint");
    if (!hint) {
      hint = document.createElement("div");
      hint.id = "wsCarouselHint";
      hint.className = "ws-widget-carousel-hint";
      document.body.appendChild(hint);
    }
    hint.textContent = `${cfg["widget-name"] || cfg.id}  (${currentIndex + 1}/${carousel.length})`;
    hint.classList.add("show");
    clearTimeout(hint._t);
    hint._t = setTimeout(() => hint.classList.remove("show"), 1400);
  }

  function cycle(direction) {
    if (isFullscreen || !carousel.length) return;
    currentIndex = currentIndex === -1
      ? (direction > 0 ? 0 : carousel.length - 1)
      : (currentIndex + direction + carousel.length) % carousel.length;
    write(ACTIVE_KEY, carousel[currentIndex].id);
    if (state === "open") mountCurrent();   // live swap, stays open
    paintBubble();
    showCarouselHint();
  }

  // ── "\" hides / shows everything (bubble, panel, fullscreen buttons) ──
  // Only hidden, never closed: an open widget keeps running and comes back
  // where it was. Remembered (HIDDEN_KEY) and followed across tabs.
  // CSS: html.ws-widgets-hidden in widgets.css.
  const widgetsHidden = () => { try { return localStorage.getItem(HIDDEN_KEY) === "true"; } catch (_) { return false; } };

  function applyHidden(hidden) {
    if (hidden) { exitFullscreen(false); reclaimFocus(); }
    document.documentElement.classList.toggle("ws-widgets-hidden", hidden);
    if (!hidden && state === "open") requestAnimationFrame(positionPanel);
  }

  function toggleHidden() {
    const hidden = !widgetsHidden();
    write(HIDDEN_KEY, String(hidden));
    applyHidden(hidden);
    toast(hidden ? "Widgets hidden. Press \\ to bring them back." : "Widgets are back.");
  }
  applyHidden(widgetsHidden());

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable)) return;

    if (e.key === "\\") {
      e.preventDefault();
      if (e.repeat) return;                                // holding \ doesn't flicker
      if (!carousel.length && !widgetsHidden()) return;    // nothing to hide
      toggleHidden();
      return;
    }

    if (!carousel.length || widgetsHidden()) return;
    if (e.key === "+" || e.key === "=")  { e.preventDefault(); if (!e.repeat) cycle(1); }
    else if (e.key === "-")             { e.preventDefault(); if (!e.repeat) cycle(-1); }
  });

  // ── Widget list + picks ──────────────────────────────────────────────
  // (Re)builds the carousel from the store's picks. Runs with the saved
  // list at once, again when the server's list arrives, and whenever the
  // store changes the picks in another tab.
  function applySelection() {
    const widgets = window._availableWidgets || [];
    let selected = readJSON(SELECTION_KEY, []);
    if (!Array.isArray(selected)) selected = [];

    const next    = selected.map((id) => widgets.find((w) => w.id === id)).filter(Boolean);
    const prevId  = currentCfg()?.id;
    const keepIdx = prevId ? next.findIndex((w) => w.id === prevId) : -1;

    // The widget that's showing was un-picked: close it while the old
    // carousel still points at it, so the right iframe is dropped.
    if (prevId && keepIdx === -1 && state !== "closed") setState("closed");
    carousel = next;

    if (!carousel.length) {
      currentIndex = -1;
      bubble.classList.remove("visible");
      return;
    }
    bubble.classList.add("visible");

    if (keepIdx !== -1) {
      currentIndex = keepIdx;
    } else {
      const savedIdx = carousel.findIndex((w) => w.id === localStorage.getItem(ACTIVE_KEY));
      currentIndex = savedIdx !== -1 ? savedIdx : 0;
    }
    paintBubble();
  }

  let hiddenNoticeShown = false;
  function noticeIfHidden() {
    if (hiddenNoticeShown || !carousel.length || !widgetsHidden()) return;
    hiddenNoticeShown = true;
    toast("Your widgets are hidden. Press \\ to show them.");
  }

  async function init() {
    // Last known list first, so the bubble is there straight away.
    const cached = readJSON(CACHE_KEY, null);
    if (Array.isArray(cached)) {
      window._availableWidgets = cached;
      applySelection();
    }
    try {
      await ticketReady();
      const res = await fetch(bustCache(SHEETS_URL), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const widgets = await res.json();
      if (!Array.isArray(widgets)) throw new Error("Widget feed did not return an array.");
      window._availableWidgets = widgets;
      write(CACHE_KEY, JSON.stringify(widgets));
    } catch (err) {
      console.error("[Widgets] Failed to load widget list:", err);
      if (!Array.isArray(window._availableWidgets)) window._availableWidgets = [];
    }
    applySelection();
    noticeIfHidden();
  }

  window.addEventListener("storage", (e) => {
    if (e.key === SELECTION_KEY && window._availableWidgets) applySelection();
    if (e.key === HIDDEN_KEY) applyHidden(e.newValue === "true");
  });

  init();
})();
