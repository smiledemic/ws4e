"use strict";

// ── Daily picks ────────────────────────────────────────────────────────
// Six assets chosen from the fetched sheet data, the same for everyone on a
// given day, refreshed at local midnight. They're shown in a pop-up over a
// blurred page, in one of two modes:
//
//   cards — six face-down cards (3 × 2). Click one to flip it, click the
//           flipped card to open the asset; "Flip all face-down" turns every
//           card back over at once.
//   wheel — a six-slice wheel. Spin to land on one; the landed pick is
//           revealed and can be opened from the result card.
//
// When the first fetch finishes (and the loader gif is gone) the pop-up
// opens by itself in a randomly chosen mode. "Not today" stops the auto
// pop-up until midnight; the Daily picks icon in the header reopens it.
// Reveals are shared between both modes and saved per day.
//
// "Reroll picks" swaps today's six for a fresh set, up to 3 times a day.
// Rerolls reset at midnight along with the picks.
//
// Opening an asset goes through WS_openAsset (main.js), so incognito modes
// and the html/txt loader behave exactly like a normal grid card.
(() => {
  const PICK_COUNT = 6;
  const STORE_KEY  = "ws_daily_picks";
  const SNOOZE_KEY = "ws_daily_snooze";
  const MODE_KEY   = "ws_daily_mode";
  const REROLL_KEY = "ws_daily_rerolls";
  const MAX_REROLLS = 3;
  const TICK_MS    = 1000;
  const FLIP_MS    = 560;
  const SPIN_MS    = 4200;
  const SLICE      = 360 / PICK_COUNT;

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const motionOK = () => !reduceMotion?.matches;

  const state = {
    day: null,
    picks: [],
    revealed: new Set(),
    mode: "cards",
    open: false,
    autoShown: false,
    spinning: false,
    rotation: 0,
    lastFocus: null,
  };

  // ── Day + seeded ranking ─────────────────────────────────────────────
  function dayKey(d = new Date()) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  // cyrb53 — small, fast, well-distributed string hash.
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  const metaOf = (row) =>
    typeof window.WS_getAssetMeta === "function" ? window.WS_getAssetMeta(row) : null;

  function isEligible(m) {
    // Merged rows are other versions of a bundle's lead (main.js): the
    // lead can be picked, its versions don't count as separate assets.
    if (!m || m.hidden || m.earlyAccess || m.merged || !m.linkTrim) return false;
    const s = m.statusSet;
    return !(s.has("cooked") || s.has("soon") || s.has("fix"));
  }

  // Each asset gets its own score for the day and the lowest six win, so
  // adding/reordering sheet rows mid-day doesn't reshuffle today's picks.
  // `roll` is how many times today's picks have been rerolled; roll 0 keeps
  // the plain day seed so everyone still shares the same first six.
  function pickForDay(rows, day, roll = 0) {
    const seed = roll ? `${day}#r${roll}` : day;
    const scored = [], seen = new Set();
    for (const row of rows) {
      const m = metaOf(row);
      if (!isEligible(m) || seen.has(m.linkTrim)) continue;
      seen.add(m.linkTrim);
      scored.push({ m, score: hash(`${seed}|${m.titleLC}|${m.linkTrim}`) });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, PICK_COUNT).map((x) => x.m);
  }

  // ── Storage ──────────────────────────────────────────────────────────
  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (_) { return null; } };
  const write    = (k, v) => { try { localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch (_) {} };

  function loadRevealed(day) {
    const saved = readJSON(STORE_KEY);
    return saved && saved.day === day && Array.isArray(saved.revealed) ? new Set(saved.revealed) : new Set();
  }
  const saveRevealed = () => write(STORE_KEY, { day: state.day, revealed: [...state.revealed] });
  const isSnoozed    = () => localStorage.getItem(SNOOZE_KEY) === dayKey();

  function rerollsUsed(day) {
    const saved = readJSON(REROLL_KEY);
    const n = saved && saved.day === day ? Number(saved.n) : 0;
    return Math.max(0, Math.min(MAX_REROLLS, Number.isFinite(n) ? n : 0));
  }

  function reveal(m) {
    if (state.revealed.has(m.linkTrim)) return;
    state.revealed.add(m.linkTrim);
    saveRevealed();
  }

  function unreveal(m) {
    if (!state.revealed.delete(m.linkTrim)) return;
    saveRevealed();
  }

  function openPick(m) {
    if (typeof window.WS_openAsset === "function") window.WS_openAsset(m.link);
    else window.open(m.link, "_blank");
  }

  function loadPicks() {
    const rows = Array.isArray(window.assetsData) ? window.assetsData : [];
    state.day   = dayKey();
    state.picks = pickForDay(rows, state.day, rerollsUsed(state.day));
    state.revealed = loadRevealed(state.day);
    const live = new Set(state.picks.map((m) => m.linkTrim));
    for (const l of [...state.revealed]) if (!live.has(l)) state.revealed.delete(l);
  }

  function randomSticker() {
    const man  = window.stickerManifest;
    const base = window.stickerBasePath || "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/main/stickers/";
    if (!man) return null;
    const keys = Object.keys(man);
    return keys.length ? base + man[keys[Math.floor(Math.random() * keys.length)]] : null;
  }

  function fallbackImg(img) {
    img.onerror = () => {
      img.onerror = null;
      if (window.config?.fallbackImage) img.src = window.config.fallbackImage;
    };
  }

  // Card backs: hand-drawn doodles in assets/media/images/card-backs/1.png
  // … CARD_BACK_COUNT.png, dealt at random with no repeats within one hand.
  // Only their shape (alpha) is used; the colour comes from the theme.
  // Paths resolve from this script, so any page that loads it works.
  const CARD_BACK_COUNT = 36;
  const CARD_BACK_BASE  = new URL("../../assets/media/images/card-backs/", document.currentScript?.src || location.href);

  function dealCardBacks(n) {
    const pool = Array.from({ length: CARD_BACK_COUNT }, (_, k) => k + 1);
    for (let k = pool.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    return Array.from({ length: n }, (_, k) => new URL(`${pool[k % pool.length]}.png`, CARD_BACK_BASE).href);
  }
  let cardBacks = [];

  // ── Overlay shell ────────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.id = "wsDailyOverlay";
  overlay.className = "wsd-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="wsd-backdrop"></div>
    <div class="wsd-frame">
    <img class="wsd-sticker" alt="" aria-hidden="true" />
    <div class="wsd-panel" role="dialog" aria-modal="true" aria-labelledby="wsdTitle" aria-describedby="wsdSub" tabindex="-1">
      <button type="button" class="wsd-close" aria-label="Close">✕</button>
      <div class="wsd-head">
        <h2 id="wsdTitle">Today's picks</h2>
        <p id="wsdSub" class="wsd-sub"></p>
      </div>
      <div class="wsd-body"></div>
      <div class="wsd-reroll-row">
        <button type="button" class="wsd-flipall"><span aria-hidden="true">↺</span> Flip all face-down</button>
        <button type="button" class="wsd-reroll"></button>
      </div>
      <div class="wsd-foot">
        <button type="button" class="wsd-switch"></button>
        <div class="wsd-countdown" role="timer" aria-label="Time until new picks">
          <span class="wsd-countdown-label">New picks in</span>
          <span class="wsd-countdown-time">--:--:--</span>
        </div>
        <button type="button" class="wsd-snooze">Not today</button>
      </div>
    </div>
    </div>`;
  document.body.appendChild(overlay);

  const panel     = overlay.querySelector(".wsd-panel");
  const body      = overlay.querySelector(".wsd-body");
  const sub       = overlay.querySelector(".wsd-sub");
  const sticker   = overlay.querySelector(".wsd-sticker");
  const switchBtn = overlay.querySelector(".wsd-switch");
  const snoozeBtn = overlay.querySelector(".wsd-snooze");
  const countdown = overlay.querySelector(".wsd-countdown-time");
  const rerollBtn = overlay.querySelector(".wsd-reroll");
  const flipAllBtn = overlay.querySelector(".wsd-flipall");

  function updateRerollBtn() {
    const left = MAX_REROLLS - rerollsUsed(state.day || dayKey());
    rerollBtn.disabled = left <= 0 || state.spinning;
    rerollBtn.innerHTML = left > 0
      ? `<span aria-hidden="true">↻</span> Reroll picks <span class="wsd-reroll-left">${left} left</span>`
      : `No rerolls left today`;
    rerollBtn.title = left > 0 ? "Swap today's six for a new set" : "Rerolls come back at midnight";
  }

  function reroll() {
    if (state.spinning) return;
    const day  = dayKey();
    const used = rerollsUsed(day);
    if (used >= MAX_REROLLS) return;
    write(REROLL_KEY, { day, n: used + 1 });
    // A new set starts face-down.
    write(STORE_KEY, { day, revealed: [] });
    loadPicks();
    renderMode();
    updateRerollBtn();
    panel.classList.remove("is-rerolling");
    void panel.offsetWidth;
    panel.classList.add("is-rerolling");
  }

  // ── Cards mode ───────────────────────────────────────────────────────
  function setFaceState(card, revealed) {
    const back  = card.querySelector(".wsd-back");
    const front = card.querySelector(".wsd-front");
    card.classList.toggle("is-revealed", revealed);
    back.inert = revealed;
    front.inert = !revealed;
    back.setAttribute("aria-hidden", String(revealed));
    front.setAttribute("aria-hidden", String(!revealed));
  }

  function buildCard(m, i) {
    const card = document.createElement("div");
    card.className = "wsd-card";
    card.style.setProperty("--i", i);
    card.style.setProperty("--tilt", `${[-3, 2, -1.5, 2.5, -2, 1.5][i % 6]}deg`);

    const inner = document.createElement("div");
    inner.className = "wsd-inner";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "wsd-back";
    back.setAttribute("aria-label", `Flip pick ${i + 1} of ${PICK_COUNT}`);
    if (i === 0 || !cardBacks[i]) cardBacks = dealCardBacks(PICK_COUNT);
    // The doodle is used as a mask (daily.css) so it's painted in the
    // theme's accent colour instead of the red it was drawn in.
    back.innerHTML = `<span class="wsd-mark"><span class="wsd-mark-ink"></span></span><span class="wsd-num">${i + 1}</span>`;
    back.querySelector(".wsd-mark-ink").style.setProperty("--mark", `url("${cardBacks[i]}")`);

    // Face-up side: the link (a real <a>, so middle-click / copy-link work).
    const front = document.createElement("div");
    front.className = "wsd-front";

    const open = document.createElement("a");
    open.className = "wsd-open";
    open.href  = m.link;
    open.title = `Click to open "${m.title || "this asset"}" in a new tab!`;

    const img = document.createElement("img");
    img.alt = m.title; img.decoding = "async"; img.src = m.image;
    fallbackImg(img);
    if (m.typeSet.has("pixelated")) img.style.imageRendering = "pixelated";

    const t = document.createElement("span"); t.className = "wsd-title";  t.textContent = m.title || "Untitled";
    const a = document.createElement("span"); a.className = "wsd-author"; a.textContent = m.author;
    open.append(img, t, a);
    front.append(open);
    inner.append(back, front);
    card.appendChild(inner);

    back.addEventListener("click", () => {
      reveal(m);
      setFaceState(card, true);
      updateFlipAllBtn();
      setTimeout(() => open.focus({ preventScroll: true }), motionOK() ? FLIP_MS : 0);
    });
    open.addEventListener("click", (e) => { e.preventDefault(); openPick(m); });

    setFaceState(card, state.revealed.has(m.linkTrim));
    return card;
  }

  function renderCards() {
    const grid = document.createElement("div");
    grid.className = "wsd-grid";
    state.picks.forEach((m, i) => grid.appendChild(buildCard(m, i)));
    body.replaceChildren(grid);
    updateFlipAllBtn();
  }

  // "Flip all face-down": only in cards mode, only while something is up.
  function updateFlipAllBtn() {
    flipAllBtn.hidden = state.mode !== "cards";
    flipAllBtn.disabled = !state.picks.some((m) => state.revealed.has(m.linkTrim));
  }

  function flipAllBack() {
    const cards = [...body.querySelectorAll(".wsd-card")];
    if (!cards.length) return;
    state.picks.forEach(unreveal);
    cards.forEach((card) => setFaceState(card, false));
    updateFlipAllBtn();
    // The button just went disabled; hand focus to the first card.
    cards[0].querySelector(".wsd-back")?.focus({ preventScroll: true });
  }

  // ── Wheel mode ───────────────────────────────────────────────────────
  const SVGNS = "http://www.w3.org/2000/svg";
  const R = 96;

  function polar(deg, r) {
    const rad = (deg - 90) * Math.PI / 180;
    return [r * Math.cos(rad), r * Math.sin(rad)];
  }

  function slicePath(i) {
    const a0 = i * SLICE - SLICE / 2, a1 = a0 + SLICE;
    const [x0, y0] = polar(a0, R), [x1, y1] = polar(a1, R);
    return `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
  }

  function sliceContent(g, m, i) {
    g.querySelector(".wsd-slice-face")?.remove();
    const face = document.createElementNS(SVGNS, "g");
    face.setAttribute("class", "wsd-slice-face");
    const [cx, cy] = polar(i * SLICE, 62);
    // Keep the face upright relative to its slice's outward direction.
    face.setAttribute("transform", `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${i * SLICE})`);

    if (state.revealed.has(m.linkTrim)) {
      const img = document.createElementNS(SVGNS, "image");
      img.setAttribute("href", m.image);
      img.setAttribute("x", "-17"); img.setAttribute("y", "-17");
      img.setAttribute("width", "34"); img.setAttribute("height", "34");
      img.setAttribute("clip-path", "url(#wsdIconClip)");
      img.setAttribute("preserveAspectRatio", "xMidYMid slice");
      const ring = document.createElementNS(SVGNS, "circle");
      ring.setAttribute("r", "18"); ring.setAttribute("class", "wsd-slice-ring");
      face.append(img, ring);
    } else {
      const q = document.createElementNS(SVGNS, "text");
      q.setAttribute("class", "wsd-slice-q");
      q.setAttribute("text-anchor", "middle");
      q.setAttribute("dominant-baseline", "central");
      q.textContent = "?";
      face.appendChild(q);
    }
    g.appendChild(face);
  }

  function renderWheel() {
    const wrap = document.createElement("div");
    wrap.className = "wsd-wheel-wrap";

    const stage = document.createElement("div");
    stage.className = "wsd-wheel-stage";

    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "-100 -100 200 200");
    svg.setAttribute("class", "wsd-wheel");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Wheel with today's six picks");
    svg.innerHTML = `<defs><clipPath id="wsdIconClip"><circle r="17"/></clipPath></defs>`;

    const rotor = document.createElementNS(SVGNS, "g");
    rotor.setAttribute("class", "wsd-rotor");
    rotor.style.transform = `rotate(${state.rotation}deg)`;

    const slices = state.picks.map((m, i) => {
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("class", `wsd-slice ${i % 2 ? "is-dark" : "is-light"}`);
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", slicePath(i));
      g.appendChild(p);
      sliceContent(g, m, i);
      rotor.appendChild(g);
      return g;
    });

    const rim = document.createElementNS(SVGNS, "circle");
    rim.setAttribute("r", String(R)); rim.setAttribute("class", "wsd-rim");
    // Little bulbs around the rim, for a showtime feel.
    const bulbs = document.createElementNS(SVGNS, "g");
    bulbs.setAttribute("class", "wsd-bulbs");
    for (let i = 0; i < 18; i++) {
      const [bx, by] = polar(i * 20, R);
      const b = document.createElementNS(SVGNS, "circle");
      b.setAttribute("cx", bx.toFixed(2)); b.setAttribute("cy", by.toFixed(2)); b.setAttribute("r", "2.6");
      b.style.setProperty("--b", i % 2);
      bulbs.appendChild(b);
    }
    rotor.append(rim, bulbs);
    svg.appendChild(rotor);

    const pointer = document.createElement("div");
    pointer.className = "wsd-pointer";
    pointer.setAttribute("aria-hidden", "true");

    const spinBtn = document.createElement("button");
    spinBtn.type = "button";
    spinBtn.className = "wsd-spin";
    spinBtn.textContent = state.revealed.size ? "Spin again" : "Spin";

    stage.append(svg, pointer, spinBtn);

    const result = document.createElement("div");
    result.className = "wsd-result";
    result.setAttribute("aria-live", "polite");
    result.hidden = true;

    wrap.append(stage, result);
    body.replaceChildren(wrap);

    spinBtn.addEventListener("click", () => {
      if (state.spinning || !state.picks.length) return;
      state.spinning = true;
      updateRerollBtn();
      spinBtn.disabled = true;
      stage.classList.add("is-spinning");
      result.hidden = true;

      const k      = Math.floor(Math.random() * state.picks.length);
      const jitter = (Math.random() - 0.5) * (SLICE * 0.6);
      const target = ((360 - k * SLICE + jitter) % 360 + 360) % 360;
      const cur    = ((state.rotation % 360) + 360) % 360;
      const turns  = motionOK() ? 360 * (5 + Math.floor(Math.random() * 3)) : 0;
      state.rotation += turns + ((target - cur + 360) % 360);

      const dur = motionOK() ? SPIN_MS : 0;
      rotor.style.transition = dur ? `transform ${dur}ms cubic-bezier(.15,.85,.2,1)` : "none";
      rotor.style.transform  = `rotate(${state.rotation}deg)`;

      setTimeout(() => {
        const m = state.picks[k];
        reveal(m);
        sliceContent(slices[k], m, k);
        slices.forEach((g, i) => g.classList.toggle("is-winner", i === k));
        stage.classList.remove("is-spinning");
        showResult(result, m);
        spinBtn.disabled = false;
        spinBtn.textContent = "Spin again";
        state.spinning = false;
        updateRerollBtn();
      }, dur + 60);
    });
  }

  function showResult(result, m) {
    result.replaceChildren();
    const img = document.createElement("img");
    img.alt = ""; img.src = m.image; fallbackImg(img);
    if (m.typeSet.has("pixelated")) img.style.imageRendering = "pixelated";

    const text = document.createElement("div");
    text.className = "wsd-result-text";
    const t = document.createElement("strong"); t.textContent = m.title || "Untitled";
    const a = document.createElement("span");   a.textContent = m.author;
    text.append(t, a);

    const go = document.createElement("a");
    go.className = "wsd-play";
    go.href = m.link;
    go.textContent = "Open it";
    go.addEventListener("click", (e) => { e.preventDefault(); openPick(m); });

    result.append(img, text, go);
    result.hidden = false;
    go.focus({ preventScroll: true });
  }

  // ── Mode switching + open/close ──────────────────────────────────────
  function renderMode() {
    overlay.dataset.mode = state.mode;
    if (state.mode === "wheel") {
      sub.textContent = "Spin to land on one of today's six.";
      switchBtn.textContent = "Flip cards instead";
      renderWheel();
      updateFlipAllBtn();
    } else {
      sub.textContent = "Flip a card to see what's under it, then click it to open.";
      switchBtn.textContent = "Spin the wheel instead";
      renderCards();
    }
  }

  function updateCountdown() {
    // Midnight: new picks, reveals cleared, rerolls back to MAX_REROLLS (all
    // three are stored per day, so a new dayKey() starts them fresh). Held
    // while the wheel is spinning so the spin lands on the pick it's showing;
    // the first tick after it stops rolls the day over.
    if (state.day && dayKey() !== state.day && !state.spinning) {
      loadPicks();
      if (state.open) renderMode();
      updateRerollBtn();
    }
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const secs = Math.max(0, Math.floor((midnight - now) / 1000));
    const pad = (n) => String(n).padStart(2, "0");
    countdown.textContent = `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`;
  }

  function openOverlay(mode) {
    if (!Array.isArray(window.assetsData)) return;
    loadPicks();
    if (!state.picks.length) return;

    state.mode = mode === "wheel" || mode === "cards" ? mode : state.mode;
    write(MODE_KEY, state.mode);

    const src = randomSticker();
    sticker.hidden = !src;
    if (src) sticker.src = src;

    renderMode();
    updateCountdown();
    updateRerollBtn();

    state.lastFocus = document.activeElement;
    state.open = true;
    overlay.hidden = false;
    document.documentElement.classList.add("wsd-lock");
    // next frame so the entrance transition runs
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add("is-open")));
    panel.focus({ preventScroll: true });
  }

  function closeOverlay() {
    if (!state.open || state.spinning) return;
    state.open = false;
    overlay.classList.remove("is-open");
    document.documentElement.classList.remove("wsd-lock");
    setTimeout(() => { if (!state.open) { overlay.hidden = true; body.replaceChildren(); } }, motionOK() ? 320 : 0);
    state.lastFocus?.focus?.({ preventScroll: true });
  }

  overlay.querySelector(".wsd-close").addEventListener("click", closeOverlay);
  overlay.querySelector(".wsd-backdrop").addEventListener("click", closeOverlay);
  switchBtn.addEventListener("click", () => {
    if (state.spinning) return;
    state.mode = state.mode === "wheel" ? "cards" : "wheel";
    write(MODE_KEY, state.mode);
    renderMode();
  });
  rerollBtn.addEventListener("click", reroll);
  flipAllBtn.addEventListener("click", flipAllBack);
  snoozeBtn.addEventListener("click", () => {
    write(SNOOZE_KEY, dayKey());
    closeOverlay();
    window.showToast?.("Daily picks won't pop up again today. Open them from the menu.");
  });

  document.addEventListener("keydown", (e) => {
    if (!state.open) return;
    if (e.key === "Escape") { e.preventDefault(); closeOverlay(); return; }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") e.stopImmediatePropagation();
    if (e.key !== "Tab") return;
    // Keep keyboard focus inside the dialog.
    const focusables = [...panel.querySelectorAll("button, a[href]")].filter((el) => !el.disabled && !el.closest("[inert]") && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);

  document.getElementById("openDailyPicks")?.addEventListener("click", (e) => {
    e.preventDefault();
    const dash = document.getElementById("dashboardMenu");
    if (dash && dash.style.display === "block") document.getElementById("dashboardBtn")?.click();
    openOverlay(localStorage.getItem(MODE_KEY) || "cards");
  });

  // ── Auto pop-up once the first fetch has finished ────────────────────
  // Waits for the loader gif to finish (body loses .ws-loading) so it
  // doesn't appear underneath it. Reloads (R) don't trigger it again.
  function whenLoaderGone(fn) {
    if (!document.body.classList.contains("ws-loading")) { fn(); return; }
    const obs = new MutationObserver(() => {
      if (!document.body.classList.contains("ws-loading")) { obs.disconnect(); fn(); }
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  document.addEventListener("ws:assets-loaded", () => {
    if (state.open) { loadPicks(); if (!state.spinning) renderMode(); }
    if (state.autoShown || window._containerMode !== "default") return;
    state.autoShown = true;
    if (isSnoozed()) return;
    const popUp = () => whenLoaderGone(() => setTimeout(() => {
      if (!isSnoozed()) openOverlay(Math.random() < 0.5 ? "cards" : "wheel");
    }, 250));
    // New/updated visitors get the tutorial first (tutorial.js); daily picks
    // wait until it — and the Shortcuts panel it ends on — is closed.
    if (window.WS_Tutorial?.pending()) document.addEventListener("ws:tutorial-done", popUp, { once: true });
    else popUp();
  });

  setInterval(() => { if (state.open) updateCountdown(); }, TICK_MS);
})();
