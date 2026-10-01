"use strict";

// ── First-visit tutorial ───────────────────────────────────────────────
// Runs for anyone who has never finished it, or who finished it on an older
// version of the site (bump TUTORIAL_VERSION to show it to everyone again).
//
//   1. Set up   — when this browser has no approved ticket yet (ticket.js),
//                 "Create your ticket" comes first: a USERNAME (unique,
//                 permanent, on the ticket) + a reason; an "I have a data
//                 file" button opens a pop-up for bringing a ticket over
//                 instead. Once approved: profile picture + an OPTIONAL
//                 nickname (a display name; the username shows without one).
//                 Steps 2–5 always wait for an approved ticket.
//   2. Pages    — change the page with the arrows (or ← →)
//   3. Search   — type in the search box; it searches every page at once
//   4. Filters  — click the grey search button to open categories
//   5. Menu     — open the ☰ menu, then click Shortcuts (the tour pauses
//                 while the Shortcuts panel is open)
//   6. Header   — once Shortcuts is closed: every header link and toggle
//                 icon in turn, each with a drop-down card under it saying
//                 what it does (TOUR_ITEMS, group "Header")
//   7. Footer   — then the page scrolls down to the footer: its links, with
//                 most of the detail on how your data is kept, exported,
//                 imported and transferred (group "Footer"); Back / Next
//                 run across both
//   8. Top      — the ⬆ Top button: what it's for, then (after 0.9s) click
//                 it to finish. That ends the tour with confetti, opens the
//                 profile, and awards the "WannaTutorialize" achievement
//                 (+15 credits, once — see credits.js)
//
// "Skip tutorial" is on every card from step 2 on (the ticket and profile in
// step 1 can't be skipped).
//
// Steps 2–5 spotlight the real controls: everything else is blurred and
// blocked, and the step moves on once the person actually does the thing.
// "Tutorial" in the ☰ menu replays them (WS_Tutorial.replay()),
// starting at step 2 — the ticket and profile are already set by then.
// Each step removes its own listeners when it ends (endStep), so nothing
// keeps watching the page once the tour is over.
// The daily-picks pop-up waits until the tutorial (and the Shortcuts panel
// it ends on) is closed — see daily.js.
//
// The ticket screens (create / sent / denied) are cards in this same layer,
// and the data-file upload is a pop-up over them. Someone who finished the
// tour but has no approved ticket gets them too ("gate only": no step
// dots, closes once approved).
//
// Needs: profile.js (saveProfile, PROFILE_IMAGES), main.js (currentPage,
// filterAssets, _cardIndex), shortcuts.js (WS_Shortcuts), ticket.js
// (WS_Ticket).
(() => {
  const TUTORIAL_VERSION = "4evr-1";
  const DONE_KEY         = "ws_tutorial_version";
  const NICK_MAX         = 20;
  // "Create your ticket" extras. They're sent as one Reason string,
  // "grade|name|role|paragraph", with N/A for the optional blanks.
  const REASON_MAX       = 800;   // the optional paragraph
  const REALNAME_MAX     = 40;    // the optional real name
  const TICKET_GRADES    = ["9", "10", "11", "12"];
  const TICKET_ROLES     = ["normie", "tester", "contributor"];
  const STEP_COUNT       = 8;

  const needsTutorial = () => {
    try { return localStorage.getItem(DONE_KEY) !== TUTORIAL_VERSION; }
    catch (_) { return false; }
  };

  // Other scripts (daily.js) check this before popping anything up.
  let pending = needsTutorial();
  let active  = false;
  window.WS_Tutorial = {
    version: TUTORIAL_VERSION,
    pending: () => pending,
    active:  () => active,
    // Handy for testing: WS_Tutorial.restart()
    restart: () => { try { localStorage.removeItem(DONE_KEY); } catch (_) {} location.reload(); },
  };

  const ticketNeeded = () => !!window.WS_Ticket && !window.WS_Ticket.approved();
  // Kept around even after the tour is done: a revoked ticket brings the
  // ticket screens back (ws:ticket-gate).
  if (!pending && !window.WS_Ticket) return;

  const $ = (sel) => document.querySelector(sel);
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  function randomSticker() {
    const man  = window.stickerManifest;
    const base = window.stickerBasePath || "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/main/stickers/";
    if (!man) return null;
    const keys = Object.keys(man);
    return keys.length ? base + man[keys[Math.floor(Math.random() * keys.length)]] : null;
  }

  // ── Layer: 4 blurred panels around a hole + ring + coach card ────────
  const root = document.createElement("div");
  root.id = "wsTutorial";
  root.className = "wst-root";
  root.hidden = true;
  root.innerHTML = `
    <div class="wst-shade wst-shade-top"></div>
    <div class="wst-shade wst-shade-bottom"></div>
    <div class="wst-shade wst-shade-left"></div>
    <div class="wst-shade wst-shade-right"></div>
    <div class="wst-ring" aria-hidden="true"></div>
    <div class="wst-hit" aria-hidden="true"></div>
    <div class="wst-card" role="dialog" aria-modal="true" aria-labelledby="wstTitle" aria-describedby="wstText" tabindex="-1">
      <img class="wst-sticker" alt="" aria-hidden="true" />
      <div class="wst-scroll">
        <ol class="wst-dots" aria-label="Tutorial progress"></ol>
        <h2 id="wstTitle" class="wst-title"></h2>
        <div id="wstText" class="wst-text"></div>
        <p class="wst-status" aria-live="polite"></p>
        <div class="wst-actions">
          <span class="wst-actions-left">
            <button type="button" class="wst-skip wst-link" hidden>Skip tutorial</button>
            <button type="button" class="wst-back" hidden>Back</button>
          </span>
          <button type="button" class="wst-next" hidden>Next</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const shades = {
    top:    root.querySelector(".wst-shade-top"),
    bottom: root.querySelector(".wst-shade-bottom"),
    left:   root.querySelector(".wst-shade-left"),
    right:  root.querySelector(".wst-shade-right"),
  };
  const ring    = root.querySelector(".wst-ring");
  const hit     = root.querySelector(".wst-hit");
  const card    = root.querySelector(".wst-card");
  const sticker = root.querySelector(".wst-sticker");
  const dotsEl  = root.querySelector(".wst-dots");
  const titleEl = root.querySelector(".wst-title");
  const textEl  = root.querySelector(".wst-text");
  const status  = root.querySelector(".wst-status");
  const nextBtn = root.querySelector(".wst-next");
  const skipBtn = root.querySelector(".wst-skip");
  const backBtn = root.querySelector(".wst-back");
  let onBack = null;

  // Nothing typed in the card (nickname, avatar arrows, Esc…) reaches the
  // page's global shortcut handlers.
  root.addEventListener("keydown", (e) => { e.stopPropagation(); });

  for (let i = 0; i < STEP_COUNT; i++) {
    const li = document.createElement("li");
    li.textContent = String(i + 1);
    dotsEl.appendChild(li);
  }

  let gateOnly  = false;  // ticket screens for someone who's done the tour
  let setupOnly = false;  // just the profile step, for someone who skipped it
  let assetsLoaded = false;
  let assetsFailed = false;
  document.addEventListener("ws:assets-failed", () => { assetsFailed = true; });

  // The profile step counts as done once it's been saved (or, for anyone
  // from before this flag, once they have a picture of their own). Until
  // then it comes back on every visit, even if the rest of the tour was
  // skipped or left half-way.
  const PROFILE_DONE_KEY = "ws_profile_setup";
  function profileSetUp() {
    try {
      if (localStorage.getItem(PROFILE_DONE_KEY) === "1") return true;
      const pic = localStorage.getItem("profilePic") || "";
      return !!pic && typeof DEFAULT_PIC !== "undefined" && pic !== DEFAULT_PIC;
    } catch (_) { return false; }
  }
  document.addEventListener("ws:assets-loaded", () => { assetsLoaded = true; });

  let spot      = null;   // { targets: () => Element[] } or null for full blur
  let onNext    = null;
  let rafId     = 0;
  let stepTick  = null;   // per-step poll run every frame

  function setDots(i) {
    [...dotsEl.children].forEach((li, n) => {
      li.classList.toggle("is-done", n < i);
      li.classList.toggle("is-current", n === i);
      if (n === i) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
  }

  function setStatus(text, ok = false) {
    status.textContent = text || "";
    status.classList.toggle("is-ok", ok);
  }

  function showNext(label = "Next", handler) {
    nextBtn.textContent = label;
    nextBtn.hidden = false;
    onNext = handler;
  }
  function hideNext() { nextBtn.hidden = true; onNext = null; }
  nextBtn.addEventListener("click", () => onNext?.());
  backBtn.addEventListener("click", () => onBack?.());
  skipBtn.addEventListener("click", () => {
    finish(false);
    window.showToast?.("Tutorial skipped. Replay it any time from ☰ → Tutorial.");
  });

  // The padded band between the ring and the real control shows a pointer
  // and passes clicks on to the nearest control, so the whole highlight
  // is clickable (see .wst-hit in tutorial.css).
  const CLICKABLE = "a[href], button, input";
  hit.addEventListener("click", (e) => {
    // Otherwise the page's "click outside closes the menu" handlers would
    // shut the ☰ / category menu right after we open it.
    e.stopPropagation();
    const els = (spot?.targets() || [])
      .flatMap((el) => (el ? [el, ...el.querySelectorAll(CLICKABLE)] : []))
      .filter((el) => el.matches(CLICKABLE));
    let best = null, bestD = Infinity;
    for (const el of els) {
      const b = el.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      const dx = Math.max(b.left - e.clientX, 0, e.clientX - b.right);
      const dy = Math.max(b.top - e.clientY, 0, e.clientY - b.bottom);
      if (dx * dx + dy * dy < bestD) { bestD = dx * dx + dy * dy; best = el; }
    }
    if (best?.tagName === "INPUT") best.focus({ preventScroll: true });
    else best?.click();
  });

  // Union of the visible target rects, padded.
  function holeRect() {
    if (!spot) return null;
    const els = spot.targets().filter((el) => el && el.isConnected);
    let r = null;
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const b = el.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      r = r
        ? { top: Math.min(r.top, b.top), left: Math.min(r.left, b.left), right: Math.max(r.right, b.right), bottom: Math.max(r.bottom, b.bottom) }
        : { top: b.top, left: b.left, right: b.right, bottom: b.bottom };
    }
    if (!r) return null;
    // Entirely off-screen (e.g. header controls cut off on narrow phones).
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return null;
    const pad = spot.pad ?? 8;
    return {
      top: Math.max(0, r.top - pad), left: Math.max(0, r.left - pad),
      right: Math.min(innerWidth, r.right + pad), bottom: Math.min(innerHeight, r.bottom + pad),
    };
  }

  const px = (n) => `${Math.round(n)}px`;
  function place(el, top, left, width, height) {
    el.style.top = px(top); el.style.left = px(left);
    el.style.width = px(Math.max(0, width)); el.style.height = px(Math.max(0, height));
  }

  function layout() {
    const W = innerWidth, H = innerHeight;
    const hole = holeRect();

    if (!hole) {
      // Full blur, no hole (setup step, or target missing).
      place(shades.top, 0, 0, W, H);
      place(shades.bottom, H, 0, W, 0);
      place(shades.left, 0, 0, 0, 0);
      place(shades.right, 0, 0, 0, 0);
      ring.classList.remove("is-on");
      hit.classList.remove("is-on");
      root.classList.add("is-centered");
      return;
    }

    root.classList.remove("is-centered");
    place(shades.top,    0,           0,          W,                 hole.top);
    place(shades.bottom, hole.bottom, 0,          W,                 H - hole.bottom);
    place(shades.left,   hole.top,    0,          hole.left,         hole.bottom - hole.top);
    place(shades.right,  hole.top,    hole.right, W - hole.right,    hole.bottom - hole.top);
    place(ring, hole.top, hole.left, hole.right - hole.left, hole.bottom - hole.top);
    ring.classList.add("is-on");
    place(hit, hole.top, hole.left, hole.right - hole.left, hole.bottom - hole.top);
    hit.style.setProperty("--wst-pad", px(spot.pad ?? 8));
    hit.classList.add("is-on");

    // Coach card: below the hole if it fits, else above, else beside it.
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 16, m = 12;
    const cx = (hole.left + hole.right) / 2;
    const clampX = (x) => Math.max(m, Math.min(W - cw - m, x));
    const clampY = (y) => Math.max(m, Math.min(H - ch - m, y));
    let top, left;
    if (hole.bottom + gap + ch + m <= H)       { top = hole.bottom + gap; left = clampX(cx - cw / 2); }
    else if (hole.top - gap - ch - m >= 0)     { top = hole.top - gap - ch; left = clampX(cx - cw / 2); }
    else if (hole.left - gap - cw - m >= 0)    { left = hole.left - gap - cw; top = clampY(hole.top); }
    else if (hole.right + gap + cw + m <= W)   { left = hole.right + gap; top = clampY(hole.top); }
    else                                       { left = clampX((W - cw) / 2); top = H - ch - m; }
    card.style.top = px(top);
    card.style.left = px(left);
    // For drop-down cards (the header tour): which side of the spotlight the
    // card sits on, and where along its edge the little pointer goes.
    card.dataset.side = top >= hole.bottom ? "below" : (top + ch <= hole.top ? "above" : "beside");
    card.style.setProperty("--caret-x", px(Math.max(22, Math.min(cw - 22, cx - left))));
  }

  let skipOffered = false;

  function loop() {
    stepTick?.();
    // If this step's control can't be seen at this screen size, don't
    // leave them stuck: explain and let them move on.
    if (spot?.skip && !skipOffered && !holeRect()) {
      skipOffered = true;
      stepTick = null;
      setStatus("That control is off-screen at this window size, so let's skip this one.");
      showNext("Next", spot.skip);
    }
    layout();
    rafId = requestAnimationFrame(loop);
  }

  // While active: keep the page still and swallow global shortcuts (panic
  // on Esc, R refetch, theme keys…) — arrow keys stay live for the page step.
  function keyGuard(e) {
    if (!active) return;
    // Keys typed inside the tutorial card are handled (and contained) by
    // the root listener below, so the card's own inputs still work.
    if (root.contains(e.target)) return;
    const k = e.key;
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "Tab" || k === "Enter" || k === " ") return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") { e.stopImmediatePropagation(); return; }
    e.stopImmediatePropagation();
    if (k === "Escape") e.preventDefault();
  }

  function focusCard() {
    card.focus({ preventScroll: true });
  }

  function setCard({ step, title, html, cls = "" }) {
    card.className = `wst-card ${cls}`.trim();
    setDots(step);
    dotsEl.hidden = gateOnly;
    skipBtn.hidden = step < 1;
    backBtn.hidden = true;
    onBack = null;
    titleEl.textContent = title;
    textEl.innerHTML = html;
    setStatus("");
    hideNext();
    skipOffered = false;
    // Restart the little pop on every step change.
    if (!reduceMotion?.matches) {
      card.classList.remove("is-popping");
      void card.offsetWidth;
      card.classList.add("is-popping");
    }
  }

  // Usernames: 3-20 of A-Z a-z 0-9 _ . -, starting with a letter or number
  // (the server checks the same, plus that it isn't too close to a taken one).
  const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,19}$/;
  const usernameProblem = (u) => !u ? "Pick a username."
    : u.length < 3 ? "Usernames are at least 3 characters."
    : !USERNAME_RE.test(u) ? "Use only letters, numbers, _ . or - (and start with a letter or number)."
    : "";
  const ticketUsername = () => window.WS_Ticket?.username?.() || "";

  // Listeners a tour step adds outside the tutorial layer (the search box,
  // the Shortcuts panel) register a cleanup here; endStep() runs them when
  // the step is left by any route — Next, skip, or the tour ending.
  let stepCleanups = [];
  const onStepEnd = (fn) => { stepCleanups.push(fn); };
  function endStep() {
    const fns = stepCleanups;
    stepCleanups = [];
    for (const fn of fns) { try { fn(); } catch (_) {} }
  }

  // Word filter (wordfilter.js): the entry a piece of text hits, or "".
  const blockedBy = (text) => window.WS_WordFilter?.find(text) || "";
  // Taken usernames (also wordfilter.js, from the filter project's
  // UsernameListed tab): the existing name this one is too close to, or "".
  // The main backend re-checks on submit.
  const usernameTakenBy = (name) => window.WS_WordFilter?.usernameTaken?.(name) || "";

  // ── Step 1: profile picture + optional nickname ──────────────────────
  function stepSetup() {
    spot = null;
    stepTick = null;
    stopPoll();

    const username     = ticketUsername();
    // No username (a ticket from before usernames existed): the nickname is
    // still required, as it was.
    const nickOptional = !!username;
    const existingNick = (localStorage.getItem("nickname") || "").trim();
    const nickStart    = existingNick && existingNick !== "Nickname" && existingNick !== username ? existingNick : "";
    const images       = Array.isArray(window.PROFILE_IMAGES) ? window.PROFILE_IMAGES
                       : (typeof PROFILE_IMAGES !== "undefined" ? PROFILE_IMAGES : []);
    const savedPic     = localStorage.getItem("profilePic") || "";
    const defaultPic   = typeof DEFAULT_PIC !== "undefined" ? DEFAULT_PIC : "";
    let chosenPic      = savedPic && savedPic !== defaultPic ? savedPic : "";

    setCard({
      step: 0,
      cls: "is-setup",
      title: setupOnly ? "Finish your profile" : approvedHere ? "Set up your profile" : "Welcome to WannaSmile!",
      html: `
        <p>${nickOptional
          ? `Pick a profile picture, and a nickname if you'd like one: it's shown instead of your username, <b>@${escapeHTML(username)}</b>. You can change both later by clicking your picture in the top-right.`
          : "Before you dive in, pick a nickname and a profile picture. You can change both later by clicking your picture in the top-right."}</p>
        <div class="wst-setup">
          <div class="wst-preview">
            <img class="wst-preview-img" alt="Your profile picture" />
            <span class="wst-preview-name"></span>
          </div>
          <div class="wst-fields">
            <label for="wstNick">Nickname${nickOptional ? " (optional)" : ""}</label>
            <input id="wstNick" type="text" maxlength="${NICK_MAX}" autocomplete="off" spellcheck="false" placeholder="${nickOptional ? `Leave blank to show @${escapeHTML(username)}` : "What should we call you?"}" />
            <span class="wst-label" id="wstPicLabel">Profile picture</span>
            <div class="wst-avatars" role="radiogroup" aria-labelledby="wstPicLabel"></div>
            <input id="wstUpload" type="file" accept="image/*" hidden />
          </div>
        </div>`,
    });

    const nick     = $("#wstNick");
    const avatars  = textEl.querySelector(".wst-avatars");
    const upload   = $("#wstUpload");
    const prevImg  = textEl.querySelector(".wst-preview-img");
    const prevName = textEl.querySelector(".wst-preview-name");
    nick.value = nickStart;

    const tiles = [];
    const addTile = (src, label, isUpload = false) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "wst-avatar" + (isUpload ? " is-upload" : "");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", label);
      if (isUpload) {
        b.innerHTML = `<span aria-hidden="true">＋</span><span class="wst-upload-text">Upload</span>`;
      } else {
        const img = document.createElement("img");
        img.alt = ""; img.src = src; img.loading = "lazy";
        b.appendChild(img);
        b.dataset.src = src;
      }
      avatars.appendChild(b);
      tiles.push(b);
      return b;
    };

    images.forEach((src, i) => addTile(src, `Picture ${i + 1}`));
    const uploadTile = addTile("", "Upload your own picture", true);

    const markChosen = () => {
      tiles.forEach((t) => {
        const on = t.dataset.src ? t.dataset.src === chosenPic : (!!chosenPic && !images.includes(chosenPic));
        t.classList.toggle("is-chosen", on);
        t.setAttribute("aria-checked", String(on));
      });
      if (chosenPic && !images.includes(chosenPic)) {
        uploadTile.style.backgroundImage = `url("${chosenPic}")`;
        uploadTile.classList.add("has-image");
      }
    };

    const validate = () => {
      const name  = nick.value.trim();
      const shown = name || username;
      prevName.textContent = shown || "Your nickname";
      prevName.classList.toggle("is-empty", !shown);
      prevImg.src = chosenPic || defaultPic;
      prevImg.classList.toggle("is-empty", !chosenPic);
      const nameBlocked = !!name && !!blockedBy(name);
      const ok = (!!name || nickOptional) && !!chosenPic && !nameBlocked;
      if (nameBlocked) {
        setStatus("That nickname isn't allowed. Try another one.");
        hideNext();
      } else if (ok) {
        setStatus(`Looking good, ${shown}!`, true);
        showNext(ticketNeeded() ? "Next: your ticket" : "Save and continue", finishSetup);
      } else {
        setStatus(!chosenPic && (name || nickOptional) ? "Now pick a picture."
                : !name && !chosenPic ? "Pick a nickname and a picture to continue."
                : "Now give yourself a nickname.");
        hideNext();
      }
    };

    avatars.addEventListener("click", (e) => {
      const t = e.target.closest(".wst-avatar");
      if (!t) return;
      if (t === uploadTile) { upload.click(); return; }
      chosenPic = t.dataset.src;
      markChosen(); validate();
    });

    // Arrow keys move between avatar tiles like a radio group.
    avatars.addEventListener("keydown", (e) => {
      const i = tiles.indexOf(document.activeElement);
      if (i < 0) return;
      const cols = getComputedStyle(avatars).gridTemplateColumns.split(" ").length || 1;
      const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      tiles[Math.max(0, Math.min(tiles.length - 1, i + d))].focus();
    });

    // Uploads are centre-cropped to a 300×300 square, same size profile.js
    // saves from its cropper.
    upload.addEventListener("change", () => {
      const file = upload.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const s = Math.min(img.width, img.height);
          const c = document.createElement("canvas");
          c.width = c.height = 300;
          c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 300, 300);
          chosenPic = c.toDataURL("image/png");
          markChosen(); validate();
        };
        img.onerror = () => setStatus("That file couldn't be read as an image. Try a PNG, JPG or GIF.");
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    nick.addEventListener("input", validate);
    nick.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && onNext) { e.preventDefault(); onNext(); }
    });

    function finishSetup() {
      // Blank nickname (optional) = show the username.
      const name = nick.value.trim().slice(0, NICK_MAX) || username;
      if (!name || !chosenPic || (nick.value.trim() && blockedBy(name))) return;
      hideNext();
      try {
        if (typeof saveProfile === "function") {
          saveProfile({ name, pic: chosenPic, pixelated: false });
        } else {
          localStorage.setItem("nickname", name);
          localStorage.setItem("profilePic", chosenPic);
        }
        localStorage.setItem(PROFILE_DONE_KEY, "1");
      } catch (err) {
        // Almost always a full browser storage (a big uploaded picture).
        console.warn("[tutorial] couldn't save the profile:", err);
        setStatus("Couldn't save that picture: this browser's storage is full. Pick one of the pictures above instead.");
        validate();
        return;
      }
      profileFirstDone = true;
      if (setupOnly) {
        setupOnly = false;
        closeGate();
        window.showToast?.(`Profile saved. Welcome, ${name}!`);
        return;
      }
      if (ticketNeeded()) afterProfileNeedsTicket();
      else continueTour();
    }

    markChosen();
    validate();
    setTimeout(() => (nick.value ? card : nick).focus({ preventScroll: true }), 50);
  }

  // ── Ticket screens (still "step 1": nothing else works without one) ──
  const TICKET_POLL_MS = 30000;
  let pollTimer = 0;
  let checking  = false;
  const stopPoll = () => { clearInterval(pollTimer); pollTimer = 0; };

  let profileFirstDone = false; // the setup step was completed this visit
  let approvedHere     = false; // a ticket got approved in this visit's flow
  let autoApprove      = null;  // from ?type=ticketinfo: new tickets instant?

  // Profile done but no approved ticket: the create card if this browser
  // never asked, otherwise whatever state its ticket is in.
  function afterProfileNeedsTicket() {
    const T = window.WS_Ticket;
    if (T.id()) { T.status() === "denied" ? stepDenied() : (stepPending(), checkTicket(false)); return; }
    stepCreateTicket();
  }

  // "Create your ticket": a USERNAME (unique, permanent — it's the ticket's
  // name) and a reason. The nickname is separate and optional (profile step).
  // Builds the ticket's Reason: "grade|name|role|paragraph" — N/A for an
  // optional blank; a "|" typed into the name or paragraph becomes "/" so
  // it can't break the format. e.g. "10|N/A|normie|N/A".
  function ticketReason({ grade, realname, role, about }) {
    const part = (v) => String(v || "").replace(/\|/g, "/").replace(/\s+/g, " ").trim() || "N/A";
    return [grade, part(realname), role, part(about)].join("|");
  }

  function stepCreateTicket(err = "") {
    stopPoll();
    spot = null;
    stepTick = null;
    const draft = stepCreateTicket.draft || {};
    const opts  = (list, pick) => list.map((v) => `<option value="${v}"${v === pick ? " selected" : ""}>${v}</option>`).join("");
    setCard({
      step: 0,
      title: "Create your ticket",
      html: `
        <p>WannaSmile is invite-only for now. ${autoApprove === true
          ? "You're early: the first 50 tickets get in straight away."
          : "Tickets are checked by hand, so yours may take a little while."} You only get one, so make it count.</p>
        <div class="wst-fields">
          <label for="wstTicketName">Username</label>
          <input id="wstTicketName" type="text" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Pick a unique username" />
          <p class="wst-note">Your username is on your ticket for good: it's unique to you and can't be changed. You can pick a display nickname afterwards.</p>
          <div class="wst-row">
            <div>
              <label for="wstGrade" class="wst-label">Grade</label>
              <select id="wstGrade"><option value="">Pick…</option>${opts(TICKET_GRADES, draft.grade)}</select>
            </div>
            <div>
              <label for="wstRole" class="wst-label">Role</label>
              <select id="wstRole"><option value="">Pick…</option>${opts(TICKET_ROLES, draft.role)}</select>
            </div>
          </div>
          <label for="wstRealName" class="wst-label">Name <span class="wst-optional">(optional)</span></label>
          <input id="wstRealName" type="text" maxlength="${REALNAME_MAX}" autocomplete="off" spellcheck="false" placeholder="Your real name, if you'd like" />
          <label for="wstReason" class="wst-label">Why do you want in? <span class="wst-optional">(optional)</span></label>
          <textarea id="wstReason" maxlength="${REASON_MAX}" rows="3" placeholder="Who sent you, what you're here for…"></textarea>
          <span class="wst-count" aria-live="polite"></span>
        </div>
        <p class="wst-alt"><button type="button" class="wst-link" data-have>I have a data file</button></p>`,
    });
    const nameEl   = $("#wstTicketName");
    const gradeEl  = $("#wstGrade");
    const roleEl   = $("#wstRole");
    const realEl   = $("#wstRealName");
    const reasonEl = $("#wstReason");
    const countEl  = textEl.querySelector(".wst-count");
    nameEl.value   = draft.name ?? "";
    realEl.value   = draft.realname ?? "";
    reasonEl.value = draft.about ?? "";
    textEl.querySelector("[data-have]").addEventListener("click", openUploadModal);

    const fields = () => ({
      name:     nameEl.value.trim(),
      grade:    gradeEl.value,
      role:     roleEl.value,
      realname: realEl.value.trim().slice(0, REALNAME_MAX),
      about:    reasonEl.value.trim().slice(0, REASON_MAX),
    });
    const problem = (f) =>
         (f.name && usernameProblem(f.name))
      || (blockedBy(f.name) ? "That username isn't allowed. Try another one." : "")
      || (usernameTakenBy(f.name) ? "That username, or one too close to it, is taken. Try another one." : "")
      || (blockedBy(f.realname) ? "That name isn't allowed." : "")
      || (blockedBy(f.about) ? "Something in your reason isn't allowed. Try rewording it." : "");
    const missing = (f) => !f.name ? "Pick a username." : !f.grade ? "Pick your grade." : !f.role ? "Pick your role." : "";

    const validate = () => {
      const f = fields();
      countEl.textContent = `${reasonEl.value.length} / ${REASON_MAX}`;
      const bad = problem(f);
      const ok  = !bad && !missing(f);
      if (ok) showNext("Create ticket", send);
      else hideNext();
      if (!err) setStatus(bad || missing(f));
      err = "";
    };
    const send = async () => {
      const f = fields();
      if (problem(f) || missing(f)) return;
      stepCreateTicket.draft = f;
      hideNext();
      setStatus("Sending your ticket…");
      let res;
      try {
        res = await window.WS_Ticket.request({ name: f.name, reason: ticketReason(f) });
      } catch (e) {
        console.warn("[tutorial] ticket request failed:", e);
        setStatus("Couldn't send that. Check your connection and try again.");
        showNext("Try again", send);
        return;
      }
      if (res.code === "name_taken") {
        stepCreateTicket("That username, or one too close to it, is taken. Pick another one, or if it's yours, use “I have a data file”.");
        return;
      }
      if (res.code === "bad_name") {
        stepCreateTicket("Use 3-20 letters, numbers, _ . or - (starting with a letter or number).");
        return;
      }
      if (res.code === "bad_reason") {
        stepCreateTicket("Pick your grade and role again, then try once more.");
        return;
      }
      stepCreateTicket.draft = null;
      showTicketStatus(res.status, res.existing ? "You'd already asked from this browser, and that ticket's approved." : "You're one of the first 50, so you're in.");
    };

    [nameEl, realEl, reasonEl].forEach((el) => el.addEventListener("input", validate));
    [gradeEl, roleEl].forEach((el) => el.addEventListener("change", validate));
    if (err) setStatus(err);
    validate();
    setTimeout(() => nameEl.focus({ preventScroll: true }), 50);
  }

  function showTicketStatus(st, approvedMsg) {
    if (st === "approved") ticketApproved(approvedMsg);
    else if (st === "denied") stepDenied();
    else stepPending();
  }

  // Approved: gate-only closes; a first-timer goes on to whichever part of
  // step 1 is left (the profile, in ticket-first order) and then the tour.
  function ticketApproved(msg = "Your ticket was approved.") {
    approvedHere = true;
    stopPoll();
    spot = null;
    stepTick = null;
    const next = gateOnly ? "Loading everything up…"
               : profileFirstDone ? "Loading everything up. The tour carries on in a second."
               : "Next up: set up your profile.";
    setCard({
      step: 0,
      title: "You're in!",
      html: `<p>${escapeHTML(msg)}</p><p>${next}</p>`,
    });
    setStatus("Ticket approved.", true);
    if (gateOnly) { setTimeout(closeGate, 1100); return; }
    // (Re-checked after the pause: if the ticket got revoked meanwhile, the
    // ticket screen is back up and must not be painted over.)
    if (!profileFirstDone) { setTimeout(() => { if (!ticketNeeded()) stepSetup(); }, 1400); return; }
    continueTour();
  }

  // On to step 2 once the (now released) asset fetch has landed and the
  // loader has gone. While that's still going, a card says so (so the
  // step never looks frozen); if it takes over CONTINUE_WAIT_MS the card
  // offers to carry on later, and if the fetch fails it says that instead.
  // Either way the tour stays pending and picks up at step 2 next visit.
  const CONTINUE_WAIT_MS = 15000;
  function continueTour(note = "Your profile is saved.") {
    let settled = false;
    let slowTimer = 0;
    const ready = () => assetsLoaded && !document.body.classList.contains("ws-loading");

    const go = () => {
      if (settled) return;
      settled = true;
      clearTimeout(slowTimer);
      document.removeEventListener("ws:assets-failed", failed);
      setTimeout(stepPages, 200);
    };
    const later = () => {
      settled = true;
      clearTimeout(slowTimer);
      closeGate();
    };
    function failed() {
      if (settled) return;
      clearTimeout(slowTimer);
      setCard({
        step: 1,
        title: "The library didn't load",
        html: `<p>${note} The library couldn't be fetched just now, so the tour will pick up from here next time.</p><p>Press <kbd>R</kbd> or reload the page to try again.</p>`,
      });
      setStatus("");
      showNext("Close for now", later);
    }

    if (ready()) { go(); return; }
    if (assetsFailed) { failed(); return; }

    spot = null;
    stepTick = null;
    setCard({
      step: 1,
      title: "Loading the library…",
      html: `<p>${note} The tour carries on as soon as the library has loaded.</p>`,
    });
    setStatus("");
    hideNext();
    slowTimer = setTimeout(() => {
      if (settled) return;
      setStatus("This is taking a while.");
      showNext("Carry on later", later);
    }, CONTINUE_WAIT_MS);

    document.addEventListener("ws:assets-failed", failed, { once: true });
    const whenLoaded = () => whenLoaderGone(go);
    if (assetsLoaded) whenLoaded();
    else document.addEventListener("ws:assets-loaded", whenLoaded, { once: true });
  }

  function ticketBox() {
    return `
      <div class="wst-ticket">
        <span class="wst-ticket-label">Your ticket</span>
        <code class="wst-ticket-id">${escapeHTML(window.WS_Ticket.id())}</code>
        <button type="button" class="wst-copy" title="Copy ticket id">Copy</button>
      </div>`;
  }

  function wireTicketBox() {
    textEl.querySelector(".wst-copy")?.addEventListener("click", (e) => {
      navigator.clipboard?.writeText(window.WS_Ticket.id()).then(() => {
        e.target.textContent = "Copied!";
        setTimeout(() => { e.target.textContent = "Copy"; }, 1200);
      }).catch(() => {});
    });
  }

  async function checkTicket(loud) {
    if (checking) return;
    checking = true;
    if (loud) setStatus("Checking…");
    try {
      const st = await window.WS_Ticket.check();
      if (st === "approved") ticketApproved();
      else if (st === "denied") stepDenied();
      else if (loud) setStatus("Still waiting on approval.");
    } catch (err) {
      console.warn("[tutorial] ticket check failed:", err);
      if (loud) setStatus("Couldn't reach the server. Try again in a moment.");
    } finally {
      checking = false;
    }
  }

  function stepPending() {
    spot = null;
    stepTick = null;
    setCard({
      step: 0,
      title: "Ticket sent!",
      html: `
        <p>You're in the queue. This page lets you in by itself once your ticket is approved.</p>
        ${ticketBox()}
        <p class="wst-note">Keep this id: it's how you get back in on another browser or device.</p>
        <p class="wst-alt"><button type="button" class="wst-link" data-have>I have a data file</button></p>`,
    });
    wireTicketBox();
    textEl.querySelector("[data-have]").addEventListener("click", openUploadModal);
    showNext("Check status", () => checkTicket(true));
    stopPoll();
    pollTimer = setInterval(() => checkTicket(false), TICKET_POLL_MS);
    focusCard();
  }

  function stepDenied() {
    stopPoll();
    spot = null;
    stepTick = null;
    setCard({
      step: 0,
      title: "Not this time",
      html: `
        <p>Your ticket wasn't approved. Tickets are one per person, so this one's final.</p>
        ${ticketBox()}
        <p class="wst-alt"><button type="button" class="wst-link" data-have>I have a data file</button></p>`,
    });
    wireTicketBox();
    textEl.querySelector("[data-have]").addEventListener("click", openUploadModal);
    focusCard();
  }

  // ── "I have a data file" pop-up ─────────────────────────────────────
  // Opened from the ticket cards; brings a ticket (and the rest of your
  // data) over from another browser with the ExportData.ws it exported.
  // There's deliberately no "type your ticket id" box: a ticket only works
  // with its secret key, which only ever lives in that file, so there's
  // nothing to guess. The file's ticket is checked with the server before
  // anything in it is saved.
  let upModal = null;

  function buildUploadModal() {
    const D = window.wsData;
    upModal = document.createElement("div");
    upModal.className = "wst-modal";
    upModal.hidden = true;
    upModal.innerHTML = `
      <div class="wst-modal-panel" role="dialog" aria-modal="true" aria-labelledby="wstUpTitle" tabindex="-1">
        <button type="button" class="wst-modal-close" aria-label="Close">✕</button>
        <h3 id="wstUpTitle" class="wst-title">Upload your data file</h3>
        <div class="wst-text">
          <p>Got a ticket on another browser or device? Over there, hit <b>Export Data</b> in the footer, then upload the <b>${escapeHTML(D?.fileName || "ExportData.ws")}</b> it saves.</p>
          <p class="wst-note">That file holds your ticket's secret key, so keep it to yourself.</p>
        </div>
        <input type="file" accept="${escapeHTML(D?.fileAccept || ".ws")}" hidden />
        <p class="wst-status" aria-live="polite"></p>
        <div class="wst-actions"><button type="button" class="wst-next">Choose file</button></div>
      </div>`;
    root.appendChild(upModal);

    const panel  = upModal.querySelector(".wst-modal-panel");
    const input  = upModal.querySelector("input[type=file]");
    const status = upModal.querySelector(".wst-status");
    const btn    = upModal.querySelector(".wst-next");
    const say = (text, ok = false) => { status.textContent = text; status.classList.toggle("is-ok", ok); };

    upModal.querySelector(".wst-modal-close").addEventListener("click", closeUploadModal);
    upModal.addEventListener("click", (e) => { if (e.target === upModal) closeUploadModal(); });
    upModal.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeUploadModal(); } });
    btn.addEventListener("click", () => input.click());
    upModal._reset = () => { say(""); btn.disabled = false; };
    upModal._panel = panel;

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file || !D) return;
      btn.disabled = true;
      say("Checking your ticket…");
      const fail = (text) => { say(text); btn.disabled = false; };

      let data;
      try { data = await D.parseDataFile(await D.readFileText(file)); }
      catch (_) { fail("That isn't a WannaSmile data file, or it's been changed. Export a fresh one."); return; }
      if (!data.ws_ticket_id) { fail("There's no ticket in that file. Export it from the browser that has one."); return; }

      let st;
      try { st = await window.WS_Ticket.verify(data.ws_ticket_id, data.ws_ticket_key); }
      catch (err) {
        console.warn("[tutorial] ticket check failed:", err);
        fail("Couldn't reach the server. Try again in a moment.");
        return;
      }
      if (st !== "approved" && st !== "pending" && st !== "denied") {
        fail("That file's ticket isn't valid. Make sure it's your latest export.");
        return;
      }

      await D.applyData(data, st);
      if (st === "approved") {
        say("Welcome back! Loading your stuff…", true);
        setTimeout(() => location.reload(), 900);
      } else {
        closeUploadModal();
        showTicketStatus(st);
      }
    });
  }

  function openUploadModal() {
    if (!upModal) buildUploadModal();
    upModal._reset();
    upModal.hidden = false;
    requestAnimationFrame(() => upModal.classList.add("is-open"));
    upModal._panel.focus({ preventScroll: true });
  }

  function closeUploadModal() {
    if (!upModal || upModal.hidden) return;
    upModal.classList.remove("is-open");
    upModal.hidden = true;
    focusCard();
  }

  // ── Step 2: pages ────────────────────────────────────────────────────
  function stepPages() {
    endStep();
    const left   = $(".pages-anchor .arrowleft");
    const right  = $(".pages-anchor .arrowright");
    const ind    = $(".pages-anchor .page-indicator");
    if (!left || !right) return stepSearch();

    spot = { targets: () => [left, ind, right], skip: stepSearch };
    const pageCount = window._cardIndex?.size || 1;
    const startPage = +window.currentPage || 1;

    setCard({
      step: 1,
      title: "Flip through pages",
      html: `<p>Assets are split into pages. Use these arrows, or the <kbd>←</kbd> <kbd>→</kbd> keys, to move between them.</p>`,
    });

    if (pageCount <= 1) {
      setStatus("There's only one page right now, but the arrows are here when there's more.", true);
      showNext("Next", stepSearch);
      stepTick = null;
      focusCard();
      return;
    }

    setStatus("Try it: go to another page.");
    // Follows every flip (page 2, then 3, then back…), not just the first.
    let shown = startPage;
    let moved = false;
    stepTick = () => {
      const now = +window.currentPage || 1;
      if (now === shown) return;
      shown = now;
      const idx = [...(window._cardIndex?.keys() || [])].sort((a, b) => a - b).indexOf(now) + 1;
      setStatus(`Nice! You're on page ${idx || now} of ${pageCount}.`, true);
      if (!moved) { moved = true; showNext("Next", stepSearch); }
    };
    focusCard();
  }

  // ── Step 3: search ───────────────────────────────────────────────────
  function clearSearch() {
    const input = $("#searchInputHeader");
    if (!input || !input.value) return;
    input.value = "";
    window.filterAssets?.("");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function stepSearch() {
    endStep();
    const input = $("#searchInputHeader");
    if (!input) return stepFilters();

    spot = { targets: () => [input], skip: () => { clearSearch(); stepFilters(); } };
    setCard({
      step: 2,
      title: "Search everything",
      html: `<p>Type a title or an author here. Search looks through <b>every page at once</b>, and results show up as you type.</p>`,
    });
    setStatus("Try it: type something.");

    let met = false;
    const onInput = () => {
      const q = input.value.trim();
      if (!q) {
        if (met) setStatus("Type something to see results.");
        return;
      }
      // filterAssets is debounced in main.js; count on the next frame after it runs.
      clearTimeout(onInput._t);
      onInput._t = setTimeout(() => {
        const n = (window._allCards || []).filter((c) => c.dataset.filtered === "true").length;
        met = true;
        setStatus(n ? `${n} match${n === 1 ? "" : "es"} for "${q}".` : `Nothing matches "${q}" yet, but you've got the idea.`, true);
        showNext("Next", () => {
          clearSearch();
          stepFilters();
        });
      }, 260);
    };
    input.addEventListener("input", onInput);
    onStepEnd(() => { input.removeEventListener("input", onInput); clearTimeout(onInput._t); });
    stepTick = null;
    setTimeout(() => input.focus({ preventScroll: true }), 50);
  }

  // ── Step 4: categories dropdown ──────────────────────────────────────
  function stepFilters() {
    endStep();
    const btn  = $("#searchBtnHeader");
    const menu = $("#searchCategoryMenu");
    if (!btn || !menu) return stepMenu();

    const isOpen = () => menu.style.display === "block";
    let phase = "";

    const toPhase = (p) => {
      if (phase === p) return;
      phase = p;
      if (p === "closed") {
        spot = { targets: () => [btn], pad: 6, skip: stepMenu };
        setCard({
          step: 3,
          title: "Filter by category",
          html: `<p>This grey button next to the search box opens <b>categories</b> and <b>sub-categories</b>.</p>`,
        });
        setStatus("Click the grey search button.");
      } else {
        spot = { targets: () => [btn, menu], pad: 8 };
        setCard({
          step: 3,
          title: "Pick a category",
          html: `<p>Click any category or sub-category to show only those assets. Click it again to turn it off. You can pick more than one.</p>`,
        });
        setStatus("Try one, or move on when you're ready.", true);
        showNext("Next", () => {
          // Leave the grid unfiltered for the rest of the tour.
          menu.querySelectorAll("button.active").forEach((b) => b.click());
          if (isOpen()) btn.click();
          stepTick = null;
          stepMenu();
        });
      }
    };

    toPhase(isOpen() ? "open" : "closed");
    stepTick = () => toPhase(isOpen() ? "open" : "closed");
    focusCard();
  }

  // ── Step 5: header → Shortcuts ──────────────────────────────────────
  // Daily picks and Shortcuts are icons in the header now (they used to be
  // links in the ☰ menu); this step points at the Shortcuts icon.
  function stepMenu() {
    endStep();
    const scBtn = $("#openShortCuts");
    if (!scBtn) return finish(false);

    spot = { targets: () => [scBtn, $("#openDailyPicks")].filter(Boolean), pad: 8, skip: () => finish(false) };
    setCard({
      step: 4,
      title: "Shortcuts & Daily picks",
      html: `<p>These two icons, next to STORE and NEWS, open <b>Daily picks</b> and <b>Shortcuts</b>, a list of every keyboard shortcut. Your <b>☰</b> menu keeps your nickname, this tutorial, your credits and <b>Clear My Data</b>.</p>`,
    });
    setStatus("Click the Shortcuts icon to see them.");

    // Shortcuts opens over everything: step aside while it's up (so it works
    // normally, Esc and all), then carry on with the header tour when it's
    // closed.
    const onShortcutsOpen = () => {
      pauseLayer();
      window.WS_Shortcuts?.setBanner("These keys work anywhere on the page. Close this panel to finish the tour with a quick look at the header.");
      const onClose = () => { resumeLayer(); stepHeader(0); };
      document.addEventListener("ws:shortcuts-close", onClose, { once: true });
      onStepEnd(() => document.removeEventListener("ws:shortcuts-close", onClose));
    };
    document.addEventListener("ws:shortcuts-open", onShortcutsOpen, { once: true });
    onStepEnd(() => document.removeEventListener("ws:shortcuts-open", onShortcutsOpen));
    focusCard();
  }

  // Hide the layer without ending the tour (Shortcuts panel on top), and back.
  function pauseLayer() {
    cancelAnimationFrame(rafId);
    window.removeEventListener("keydown", keyGuard, true);
    document.documentElement.classList.remove("wst-lock");
    root.classList.remove("is-open");
    root.hidden = true;
  }
  function resumeLayer() {
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add("is-open"));
    document.documentElement.classList.add("wst-lock");
    window.addEventListener("keydown", keyGuard, true);
    loop();
  }

  // ── Steps 6–7: the header, then the footer, one item at a time ───────
  // Each entry spotlights its element(s) — `sel` (CSS selectors) or `text`
  // (footer links matched by their label, since index.html and main.html
  // differ there) — with a drop-down card next to it. `scroll` entries are
  // scrolled into view first (the footer); the rest put the page back at the
  // top. Items missing from the page (or hidden) are left out.
  const HEADER_TOUR = [
    { sel: [".nav-links > a:first-of-type"], title: "Home",
      html: "<p>Opens WannaSmile's home page in a <b>new tab</b>, so this one stays right where it is.</p>" },
    { sel: [".nav-links a[href*='pages/discovery/']"], title: "Discovery",
      html: "<p>Opens <b>Discovery</b> in a new tab: the whole library with its average ratings. Rate what you've tried (once per asset), and find what others liked.</p>" },
    { sel: [".nav-links a[href*='pages/settings/']"], title: "Settings",
      html: "<p>Opens <b>Settings</b> in a new tab. Choose how the library is paged (page by page or all on one, in sheet order or A–Z), whether search and category filters stay on the current page, and whether flipping a page takes you back to the top. Changes show up here straight away.</p>" },
    { sel: [".nav-links a[href*='padlet']"], title: "Suggestions",
      html: "<p>Opens our Padlet board in a new tab. Suggest an addition, ask for a feature, or tell us when something's broken.</p>" },
    { sel: [".pages-anchor a[href*='pages/store/']"], title: "Store",
      html: "<p>Opens the <b>Store</b> in a new tab, where you pick:</p><p>• <b>Widgets</b> for the floating bubble (<kbd>+</kbd> <kbd>−</kbd> switch between them)<br>• <b>Themes</b>, with up to 9 on the number keys <kbd>1</kbd>–<kbd>9</kbd> (<kbd>0</kbd> goes back to Redux)<br>• <b>Gif packs</b> for the loading animations (<kbd>[</kbd> <kbd>]</kbd> cycle them)</p>" },
    { sel: [".pages-anchor a[title='Coming soon']"], title: "NEWS",
      html: "<p><b>Coming soon:</b> announcements and what's new on the site.</p>" },
    { sel: ["#openDailyPicks"], title: "Daily picks",
      html: "<p>Opens today's <b>six picks</b>, the same for everyone, as face-down cards or a spin wheel. It also opens by itself after the first load; <b>Not today</b> keeps it quiet until midnight.</p>" },
    { sel: [".mute-btn"], title: "Sound",
      html: "<p>Turns the site's sound on or off, like the music some quotes play. It shows <b>BOOM</b> when sound is on and <b>SHUT</b> when it's muted, and it remembers your choice.</p>" },
    { sel: [".Qtype", "#quoteWrapper"], title: "Quote bar style",
      html: "<p>Changes how the quote bar under the header moves. Click to cycle: <b>scroll left</b>, <b>scroll right</b>, or <b>one quote at a time</b>, centred.</p>" },
    { sel: ["#nes-btn"], title: "Panic button",
      html: "<p>Arms the panic key. While it's armed (the icon changes), pressing <kbd>Esc</kbd> instantly sends this tab to your panic page (Google unless you've changed it). Click it again to disarm.</p>" },
    { sel: ["#cloak-btn"], title: "Tab cloak",
      html: "<p>Disguises this tab: its title and icon change to look like Google, so a glance at your tabs doesn't give you away. Click again to show the real one.</p><p>For more cover, <kbd>T</kbd> reopens the site inside an <b>about:blank</b> or <b>blob</b> page.</p>" },
    { sel: ["#fav-btn"], title: "Favorites",
      html: "<p>Shows <b>only your favorites</b>, in the order you added them. Star any asset with its ☆ to add it. Click again to see everything.</p>" },
    { sel: ["#pfp"], title: "Your profile",
      html: "<p>Change your picture, banner and nickname here. Your username stays the same: it's on your ticket.</p>" },
  ].map((item) => ({ ...item, group: "Header", step: 5 }));

  const FOOTER_TOUR = [
    { text: ["source"], title: "Source code",
      html: "<p>Opens the site's code on GitHub in a new tab, if you're curious how it all works.</p>" },
    { text: ["DMCA"], title: "DMCA",
      html: "<p>Opens the <b>DMCA policy</b> in a new tab. If you own something hosted here and want it taken down, it explains what a notice needs and files the request for you.</p>" },
    { text: ["Discord"], title: "Discord",
      html: "<p>Opens the WannaSmile <b>Discord</b> page in a new tab: news, help, and people to connect with. The server isn't open yet, so it also links to Ankom Studios' other pages in the meantime.</p>" },
    { text: ["Import Data", "Export Data", "Transfer Data"], title: "Your data lives in this browser",
      html: "<p>There are no accounts to log in to. Everything you set up is saved <b>only in this browser</b>: your access ticket (and its secret key), username and nickname, profile picture and banner, favorites, themes and their shortcuts, widgets, gif packs, and your cloak and panic settings.</p><p>Clearing your browser data, or <b>☰ → Clear My Data</b>, wipes it. These three links are how you keep it safe or take it somewhere else.</p>" },
    { text: ["Export Data"], title: "Export Data",
      html: "<p>Downloads everything as one file, <b>ExportData.ws</b>. Keep it somewhere safe: it's your backup, and it's how you move to another browser or device.</p><p>It holds your ticket's <b>secret key</b>, so treat it like a password and don't share it. Anyone with it can get in as you.</p>" },
    { text: ["Import Data"], title: "Import Data",
      html: "<p>Loads an <b>ExportData.ws</b> back in, then reload the page to see it. The file's ticket is checked with the server first and only taken if it's valid, so a broken or edited file can't break your access; your other settings still come across.</p><p>On a new device, use <b>I have a data file</b> on the ticket screen instead: it does the same and lets you straight in.</p>" },
    { text: ["Transfer Data"], title: "Transfer Data",
      html: "<p>Copies a <b>link</b> with all your data packed inside. Open it in another browser and everything comes over, ticket included (checked with the server, same as a file).</p><p>That link is just as private as the file: don't post it or send it to anyone else.</p>" },
    { sel: ["#footerVersion"], title: "Version",
      html: "<p>Which version of the site you're on. The code in brackets is the latest update: click it to see exactly what changed on GitHub.</p>" },
  ].map((item) => ({ ...item, group: "Footer", step: 6, scroll: true }));

  const TOUR_ITEMS = HEADER_TOUR.concat(FOOTER_TOUR);

  const footerLinks = () => [...document.querySelectorAll("footer a")];
  const tourElements = (item) => item.text
    ? footerLinks().filter((a) => item.text.some((t) => a.textContent.trim().toLowerCase().startsWith(t.toLowerCase())))
    : item.sel.flatMap((q) => [...document.querySelectorAll(q)]);
  const headerItems = () => TOUR_ITEMS
    .map((item) => ({ ...item, els: tourElements(item) }))
    .filter((item) => item.els.some((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden"));

  function stepHeader(i = 0) {
    endStep();
    const items = headerItems();
    if (!items.length) { finish(false); return; }
    i = Math.max(0, Math.min(items.length - 1, i));
    const item = items[i];
    const last = i === items.length - 1;
    // Footer items: bring the footer into view (the tour locks scrolling, so
    // it's done here); header items: back to the top.
    if (item.scroll) item.els[0].scrollIntoView({ block: "center", behavior: "instant" });
    else window.scrollTo({ top: 0, behavior: "instant" });
    const inGroup = items.filter((x) => x.group === item.group);
    const pos     = inGroup.indexOf(item) + 1;
    spot = { targets: () => item.els, pad: 6, skip: () => (last ? stepGoTop() : stepHeader(i + 1)) };
    stepTick = null;
    setCard({
      step: item.step,
      cls: "is-dropdown",
      title: item.title,
      html: `${item.html}<p class="wst-note">${item.group} tour · ${pos} of ${inGroup.length}</p>`,
    });
    if (i > 0) { backBtn.hidden = false; onBack = () => stepHeader(i - 1); }
    showNext("Next", () => (last ? stepGoTop() : stepHeader(i + 1)));
    focusCard();
  }

  // ── Step 8: the ⬆ Top button ─────────────────────────────────────────
  // It only shows once you've scrolled down (ui.js); the footer part of the
  // tour has already done that. Locked for GO_TOP_DELAY_MS so the card gets
  // read first, then clicking it finishes the tour.
  const GO_TOP_DELAY_MS = 900;

  function stepGoTop() {
    endStep();
    const btn = $("#toTopBtn");
    if (!btn) { finish("complete"); return; }
    document.querySelector("footer")?.scrollIntoView({ block: "end", behavior: "instant" });
    // tutorial.css hides the button during tours, except for this step.
    document.documentElement.classList.add("wst-show-top");
    btn.disabled = true;
    spot = { targets: () => [btn], pad: 8 };
    stepTick = null;
    setCard({
      step: 7,
      cls: "is-dropdown",
      title: "Back to the top",
      html: `<p>Scrolled a long way down? This button pops up once you're far enough down the page, and takes you straight back up to the top.</p><p class="wst-note">Last one: click it to finish the tour.</p>`,
    });
    backBtn.hidden = false;
    onBack = () => stepHeader(headerItems().length - 1);
    setStatus("Take a look first…");

    const arm = setTimeout(() => {
      btn.disabled = false;
      btn.classList.add("wst-go");
      setStatus("Go on, give it a click!", true);
    }, GO_TOP_DELAY_MS);
    // ui.js's own click handler does the scrolling; this just ends the tour.
    const onClick = () => { if (!btn.disabled) finish("complete"); };
    btn.addEventListener("click", onClick);
    onStepEnd(() => {
      clearTimeout(arm);
      btn.disabled = false;
      btn.classList.remove("wst-go");
      btn.removeEventListener("click", onClick);
      document.documentElement.classList.remove("wst-show-top");
    });
    focusCard();
  }

  // ── The finish: confetti, the profile, and the achievement ───────────
  function confetti(ms = 2600) {
    if (reduceMotion?.matches) return;
    const c = document.createElement("canvas");
    c.className = "wst-confetti";
    c.width = innerWidth; c.height = innerHeight;
    document.body.appendChild(c);
    const ctx = c.getContext("2d");
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-color").trim() || "#ff4444";
    const colors = [accent, "#ffd23f", "#3ec1ff", "#7cff6b", "#ff6bd6", "#ffffff"];
    const bits = Array.from({ length: 170 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3,
      y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 15 - 5,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    const frame = (t) => {
      const age = t - t0;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - ms * 0.6) / (ms * 0.4));
      for (const b of bits) {
        b.vy += 0.38; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
        ctx.fillStyle = b.color; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 2)));
        ctx.restore();
      }
      if (age < ms) requestAnimationFrame(frame); else c.remove();
    };
    requestAnimationFrame(frame);
  }

  // Resolves when the profile modal (opened by celebrate) is closed again.
  function whenProfileClosed() {
    const ov = document.getElementById("profileOverlay");
    if (!ov || !ov.classList.contains("visible")) return Promise.resolve();
    return new Promise((resolve) => {
      const obs = new MutationObserver(() => {
        if (!ov.classList.contains("visible")) { obs.disconnect(); resolve(); }
      });
      obs.observe(ov, { attributes: true, attributeFilter: ["class"] });
    });
  }

  function celebrate() {
    confetti();
    setTimeout(() => window.openProfileOverlay?.(), 450);
    window.WS_Credits?.award("wannatutorialize").then((isNew) => {
      if (!isNew) window.showToast?.("🏆 WannaTutorialize is already yours. Thanks for touring again!", 4000);
    });
  }

  // ── Start / finish ───────────────────────────────────────────────────
  // Put the layer up (full blur until a step spotlights something).
  function begin() {
    if (active) return false;
    active = true;
    window.scrollTo({ top: 0, behavior: "instant" });
    document.documentElement.classList.add("wst-lock");
    const src = randomSticker();
    sticker.hidden = !src;
    sticker.onerror = () => { sticker.hidden = true; }; // e.g. relative path from a sub-page
    if (src) sticker.src = src;
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add("is-open"));
    window.addEventListener("keydown", keyGuard, true);
    loop();
    return true;
  }

  // First visit, or a tour left unfinished: from the profile step if it
  // was never saved, otherwise straight on from step 2 (the library is in
  // by the time this runs).
  async function start() {
    if (active) return;
    await window.WS_WordFilter?.load();
    if (!begin()) return;
    if (profileSetUp()) { profileFirstDone = true; stepPages(); }
    else stepSetup();
  }

  // Tour done (or skipped) but the profile never saved: just that step,
  // then the layer closes.
  async function startSetupOnly() {
    if (active || profileSetUp() || ticketNeeded()) return;
    await window.WS_WordFilter?.load();
    gateOnly = true;          // no step dots: this isn't the tour
    setupOnly = true;
    if (begin()) stepSetup();
  }

  // Ticket screens: no approved ticket in this browser. The Welcome step
  // is the request form for someone who's never asked; otherwise it's the
  // matching status card.
  //
  // No ticket in this browser -> "Create your ticket" (its "I have a data
  // file" button opens the upload pop-up); the profile setup follows
  // approval. A repeat request from the same browser just gets its
  // existing ticket back from the server, so there's no separate path.
  // ?type=ticketinfo only changes the wording (instant vs. queued).
  async function openGate() {
    if (!ticketNeeded()) return;
    gateOnly = !pending;
    begin();
    const T = window.WS_Ticket;
    if (T.id()) {
      if (T.status() === "denied") { stepDenied(); return; }
      stepPending();
      checkTicket(false);
      return;
    }
    setCard({ step: 0, title: "Welcome to WannaSmile!", html: "<p>One sec…</p>" });
    // The word list comes in before the first screen, alongside the
    // instant-vs-queued check (wordfilter.js gives up after a few seconds).
    [autoApprove] = await Promise.all([T.info(), window.WS_WordFilter?.load(), window.WS_WordFilter?.loadUsernames()]);
    stepCreateTicket();
  }

  // Gate-only close (the tour was already done): same as finish() minus
  // the tour's done flag, banner and ws:tutorial-done.
  function closeGate() {
    endStep();
    closeUploadModal();
    stopPoll();
    active = false;
    stepTick = null;
    cancelAnimationFrame(rafId);
    window.removeEventListener("keydown", keyGuard, true);
    document.documentElement.classList.remove("wst-lock");
    root.classList.remove("is-open");
    setTimeout(() => { root.hidden = true; }, 250);
  }

  // how: "complete" when the tour was seen through (the ⬆ Top click);
  // anything else = ended early (Skip tutorial, or a control that's missing).
  function finish(how) {
    endStep();
    closeUploadModal();
    stopPoll();
    active = false;
    stepTick = null;
    cancelAnimationFrame(rafId);
    window.removeEventListener("keydown", keyGuard, true);
    document.documentElement.classList.remove("wst-lock");
    root.classList.remove("is-open");
    setTimeout(() => { root.hidden = true; }, 250);
    try { localStorage.setItem(DONE_KEY, TUTORIAL_VERSION); } catch (_) {}

    const nick = (localStorage.getItem("nickname") || "").trim();
    const done = () => {
      pending = false;
      document.dispatchEvent(new CustomEvent("ws:tutorial-done"));
    };

    if (how === "complete") {
      celebrate();
      // Daily picks (daily.js) waits for ws:tutorial-done: hold it until
      // they've closed the profile the celebration opened.
      setTimeout(() => whenProfileClosed().then(done), 600);
    } else {
      window.showToast?.(`That's the tour${nick ? `, ${nick}` : ""}! Replay it any time from ☰ → Tutorial.`);
      done();
    }
  }

  // Start once the first asset fetch is in and the loader gif is gone, so
  // there are real pages and results to show.
  function whenLoaderGone(fn) {
    if (!document.body.classList.contains("ws-loading")) { fn(); return; }
    const obs = new MutationObserver(() => {
      if (!document.body.classList.contains("ws-loading")) { obs.disconnect(); fn(); }
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  document.addEventListener("ws:assets-loaded", () => {
    if (active || window._containerMode !== "default") return;
    if (pending) whenLoaderGone(() => setTimeout(start, 200));
    else if (!profileSetUp()) whenLoaderGone(() => setTimeout(startSetupOnly, 200));
  }, { once: true });

  // "Tutorial" (☰ menu): the tour again from "Flip through pages" —
  // the ticket, profile and nickname are already set by then. Without an
  // approved ticket there's nothing to tour, so that shows the ticket
  // screen instead.
  function replay() {
    if (active) return;
    if (ticketNeeded()) { openGate(); return; }
    gateOnly = false;
    const dash = $("#dashboardMenu");
    if (dash && dash.style.display === "block") $("#dashboardBtn")?.click();
    begin();
    if (assetsLoaded && !document.body.classList.contains("ws-loading")) {
      stepPages();
    } else {
      continueTour("One sec.");
    }
  }
  window.WS_Tutorial.replay = replay;
  document.getElementById("openTour")?.addEventListener("click", (e) => { e.preventDefault(); replay(); });

  // No approved ticket: nothing can load, so the ticket screens go up
  // straight away instead of waiting for assets like the tour does.
  document.addEventListener("ws:ticket-gate", openGate);
  if (ticketNeeded()) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", openGate, { once: true });
    else openGate();
  }
})();
