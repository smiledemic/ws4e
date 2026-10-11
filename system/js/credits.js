"use strict";

// ── Credits & achievements ─────────────────────────────────────────────
// Credits are earned (mostly from achievements) and spent to unlock content
// early, before it's fully released. Everything lives in this browser's
// localStorage, travels in the data file (ExportData.ws) with the rest of
// the user's data, and is wiped by Clear My Data — see data.js. Clearing
// takes the balance AND the earned achievements back to zero together, so
// clearing and re-earning can't stack credits (15 -> clear -> 15, never 30).
// The balance is only shown on the credits page, not in the ☰ menu.
//
//   ws_credits       the balance (a whole number)
//   ws_credit_log    newest-first history: [{ amount, reason, at }]
//   ws_achievements  earned ones: { <id>: <ISO date> }
//   ws_unlocks       unlocked early-access items: { <id>: <ISO date> }
//
// Being browser-side, this is honour-system: someone could edit their own
// localStorage. Fine for cosmetic early access; anything that really matters
// would need the server to keep the balance.
//
// ACHIEVEMENTS and UNLOCKABLES below are the catalogs — add entries there.
// The credits page (system/pages/credits-n-achievements/) lists both.
//
// window.WS_Credits = {
//   balance(), history(), achievements() -> catalog with earned dates,
//   hasAchievement(id), award(id) -> Promise<boolean> (false if already earned),
//   add(amount, reason), spend(amount, reason) -> boolean,
//   unlockables() -> catalog with unlocked dates, isUnlocked(id), unlock(id) -> result,
//   progress(id) -> count toward a goal achievement,
//   noteRating(link, rating, all?), noteVisit(href),
// }
// Fires "ws:credits-change" on document whenever anything changes.
(() => {
  const BAL_KEY  = "ws_credits";
  const LOG_KEY  = "ws_credit_log";
  const ACH_KEY  = "ws_achievements";
  const UNL_KEY  = "ws_unlocks";
  const LOG_MAX  = 100;

  // `goal`: earned once progress(id) reaches it (see PROGRESS below).
  const ACHIEVEMENTS = [
    { id: "wannatutorialize", name: "WannaTutorialize", icon: "trophy", credits: 15,
      desc: "Finished the WannaSmile tour, all the way to the ⬆ Top button.",
      how: "Open ☰ → Tutorial and see it through to the end." },
    { id: "criticalReviewer", name: "Critical Reviewer", icon: "star-half", credits: 20, goal: 5,
      desc: "Rated 5 assets of the library in Discovery.",
      how: "Open Discovery and rate 5 different assets." },
    { id: "adventurist", name: "Adventurist", icon: "compass", credits: 15, goal: 20,
      desc: "Visited 20 different links around the site.",
      how: "Open 20 different links: assets, the header, the footer, the ☰ menu, anywhere on the site." },
  ];

  // Progress toward the goal achievements, kept in this browser:
  //   ws_rated        { link: rating } the assets rated in Discovery (the
  //                   Discovery page fills it from the server's copy too)
  //   ws_link_visits  distinct links opened on the site (up to VISIT_MAX)
  const RATED_KEY  = "ws_rated";
  const VISIT_KEY  = "ws_link_visits";
  const VISIT_MAX  = 100;

  // Early-access content, bought with credits. `cost` in credits.
  // e.g. { id: "theme-wolf", name: "Wolf theme (early)", cost: 20, desc: "…" }
  const UNLOCKABLES = [];

  const readJSON = (k, fallback) => {
    try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? fallback; } catch (_) { return fallback; }
  };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  const balance = () => Math.max(0, parseInt(localStorage.getItem(BAL_KEY) || "0", 10) || 0);
  const history = () => { const v = readJSON(LOG_KEY, []); return Array.isArray(v) ? v : []; };
  const earned  = () => { const v = readJSON(ACH_KEY, {}); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
  const unlocked = () => { const v = readJSON(UNL_KEY, {}); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };

  function changed(detail) {
    document.dispatchEvent(new CustomEvent("ws:credits-change", { detail }));
  }

  function record(amount, reason) {
    const next = Math.max(0, balance() + amount);
    try { localStorage.setItem(BAL_KEY, String(next)); } catch (_) {}
    writeJSON(LOG_KEY, [{ amount, reason, at: new Date().toISOString() }, ...history()].slice(0, LOG_MAX));
    return next;
  }

  function add(amount, reason = "Credits") {
    amount = Math.floor(+amount || 0);
    if (amount <= 0) return balance();
    const next = record(amount, reason);
    changed({ type: "add", amount, reason });
    return next;
  }

  function spend(amount, reason = "Spent") {
    amount = Math.floor(+amount || 0);
    if (amount <= 0 || amount > balance()) return false;
    record(-amount, reason);
    changed({ type: "spend", amount, reason });
    return true;
  }

  const hasAchievement = (id) => !!earned()[id];

  function achievements() {
    const got = earned();
    return ACHIEVEMENTS.map((a) => ({ ...a, earnedAt: got[a.id] || null, progress: a.goal ? progress(a.id) : null }));
  }

  // ── Goal achievements ────────────────────────────────────────────────
  const rated  = () => { const v = readJSON(RATED_KEY, {}); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
  const visits = () => { const v = readJSON(VISIT_KEY, []); return Array.isArray(v) ? v : []; };

  const PROGRESS = {
    criticalReviewer: () => Object.keys(rated()).length,
    adventurist:      () => visits().length,
  };
  const progress = (id) => (PROGRESS[id] ? PROGRESS[id]() : 0);

  // Awards any goal achievement whose goal has been reached.
  function checkGoals() {
    for (const a of ACHIEVEMENTS) {
      if (a.goal && !hasAchievement(a.id) && progress(a.id) >= a.goal) award(a.id);
    }
  }

  // Discovery: a rating went through (or the server says it was made
  // earlier). `all` replaces the whole list with the server's copy.
  function noteRating(link, rating, all) {
    const next = all && typeof all === "object" ? { ...all } : { ...rated(), [link]: rating };
    writeJSON(RATED_KEY, next);
    changed({ type: "progress", id: "criticalReviewer" });
    checkGoals();
  }

  // Adventurist: every distinct link opened on the site counts once, from
  // anywhere (asset cards, header, footer, ☰ menu, pop-ups). "#" links and
  // same-page jumps don't count.
  function noteVisit(href) {
    let url;
    try { url = new URL(href, location.href); } catch (_) { return; }
    if (!/^https?:$/.test(url.protocol)) return;
    url.hash = "";
    const here = new URL(location.href); here.hash = "";
    if (url.href === here.href) return;
    const list = visits();
    if (list.includes(url.href)) return;
    writeJSON(VISIT_KEY, [...list, url.href].slice(-VISIT_MAX));
    changed({ type: "progress", id: "adventurist" });
    checkGoals();
  }

  const onLinkOpen = (e) => {
    if (e.type === "auxclick" && e.button !== 1) return;
    const a = e.target.closest?.("a[href]");
    const raw = a?.getAttribute("href");
    if (!raw || raw === "#" || /^javascript:/i.test(raw)) return;
    noteVisit(a.href);
  };
  document.addEventListener("click", onLinkOpen, true);
  document.addEventListener("auxclick", onLinkOpen, true);

  function unlockables() {
    const got = unlocked();
    return UNLOCKABLES.map((u) => ({ ...u, unlockedAt: got[u.id] || null }));
  }
  const isUnlocked = (id) => !!unlocked()[id];

  function unlock(id) {
    const item = UNLOCKABLES.find((u) => u.id === id);
    if (!item) return { ok: false, error: "unknown" };
    if (isUnlocked(id)) return { ok: true, already: true };
    if (!spend(item.cost, `Unlocked: ${item.name}`)) return { ok: false, error: "not_enough" };
    writeJSON(UNL_KEY, { ...unlocked(), [id]: new Date().toISOString() });
    changed({ type: "unlock", id });
    return { ok: true };
  }

  // Paid assets (the sheet's credit-price column): one purchase per asset,
  // kept in ws_unlocks under "asset:<link>", so it travels in the data file
  // with the rest and re-downloading is free. purchase() -> { ok, already? }
  // | { ok:false, error:"not_enough", need, balance }.
  const assetKey = (link) => "asset:" + String(link || "").trim();
  const hasPurchased = (link) => !!unlocked()[assetKey(link)];

  function purchase(link, cost, name = "asset") {
    cost = Math.floor(+cost || 0);
    if (!link) return { ok: false, error: "unknown" };
    if (cost <= 0 || hasPurchased(link)) return { ok: true, already: true };
    if (cost > balance()) return { ok: false, error: "not_enough", need: cost - balance(), balance: balance() };
    spend(cost, `Download: ${name}`);
    writeJSON(UNL_KEY, { ...unlocked(), [assetKey(link)]: new Date().toISOString() });
    changed({ type: "unlock", id: assetKey(link) });
    return { ok: true };
  }

  // ── Site alerts: Shoelace alerts sliding in at the top right ──────────
  // (sl-alert.toast()), styled like the asset description card: theme
  // panel, accent border + offset accent shadow, a slight tilt, monospace.
  // Used for achievements and early-access notices (main.js). Shoelace's
  // components come from its CDN autoloader; if they aren't there, the
  // site's own toast is used instead.
  //
  // window.WS_Alert.show({ icon, title, text, chip, action: { label, href }, duration })
  const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const ALERT_CSS = `
    .ws-alert { transform: rotate(-1.2deg); }
    .ws-alert::part(base) {
      border: 3px solid var(--accent-color, #f44);
      border-radius: 20px 16px 22px 14px;
      background: var(--aside-bg, rgba(0, 0, 0, 0.92));
      color: var(--url-color, #fff);
      box-shadow: 7px 7px 0 var(--accent-color, #f44);
      font-family: monospace;
    }
    .ws-alert::part(icon) { color: var(--accent-color, #f44); font-size: 1.7rem; padding-inline-start: 16px; }
    .ws-alert::part(message) { padding: 14px 14px 14px 12px; }
    .ws-alert::part(close-button) { color: var(--url-color, #fff); }
    .ws-alert, .ws-alert :not(sl-icon) { font-family: monospace; }
    .ws-alert .ws-alert-title {
      display: block;
      margin-bottom: 5px;
      font-weight: bold;
      font-size: 14px;
      line-height: 1.3;
      text-shadow: 2px 2px 0 var(--accent-color, #f44);
    }
    .ws-alert .ws-alert-text { display: block; font-size: 12.5px; line-height: 1.55; opacity: 0.9; }
    .ws-alert .ws-alert-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .ws-alert .ws-alert-chip {
      padding: 2px 9px;
      border-radius: 999px;
      background: var(--accent-color, #f44);
      color: #fff;
      font-weight: bold;
      font-size: 12px;
      transform: rotate(-3deg);
    }
    .ws-alert .ws-alert-action {
      padding: 4px 12px;
      border-radius: 999px;
      border: 2px solid var(--accent-color, #f44);
      color: var(--url-color, #fff);
      font-weight: bold;
      font-size: 12px;
      text-decoration: none;
      box-shadow: 0 3px 0 var(--accent-color, #f44);
    }
    .ws-alert .ws-alert-action:hover { background: var(--accent-color, #f44); color: #fff; }
    .sl-toast-stack { padding-right: 10px; }
  `;
  function ensureAlertStyles() {
    if (document.getElementById("ws-alert-css")) return;
    const st = document.createElement("style");
    st.id = "ws-alert-css";
    st.textContent = ALERT_CSS;
    document.head.appendChild(st);
  }

  async function showAlert({ icon = "bell", title = "", text = "", chip = "", action = null, duration = 7000 } = {}) {
    const plain = [title, text, chip].filter(Boolean).join("  ·  ");
    ensureAlertStyles();
    document.documentElement.classList.add("sl-theme-dark");
    const alert = document.createElement("sl-alert");
    alert.className = "ws-alert";
    alert.setAttribute("variant", "primary");
    alert.setAttribute("closable", "");
    alert.setAttribute("duration", String(duration));
    const foot = chip || action
      ? `<span class="ws-alert-foot">${chip ? `<span class="ws-alert-chip">${escapeHTML(chip)}</span>` : ""}${action
          ? `<a class="ws-alert-action" href="${escapeHTML(action.href)}" target="_blank" rel="noopener">${escapeHTML(action.label)}</a>` : ""}</span>`
      : "";
    alert.innerHTML = `
      <sl-icon slot="icon" name="${escapeHTML(icon)}"></sl-icon>
      <span class="ws-alert-title">${escapeHTML(title)}</span>
      ${text ? `<span class="ws-alert-text">${escapeHTML(text)}</span>` : ""}
      ${foot}`;
    // In the page first: Shoelace's autoloader only fetches a component once
    // it sees the tag in the DOM. (Unshown alerts are hidden, so nothing
    // flashes while it loads.)
    document.body.appendChild(alert);
    const ready = !!customElements.get("sl-alert") || await Promise.race([
      customElements.whenDefined("sl-alert").then(() => true),
      new Promise((r) => setTimeout(() => r(false), 4000)),
    ]);
    if (!ready) { alert.remove(); window.showToast?.(plain, 5000); return; }
    try { await alert.toast(); } catch (_) { alert.remove(); window.showToast?.(plain, 5000); }
  }
  window.WS_Alert = { show: showAlert };

  function announce(a) {
    return showAlert({
      icon: a.icon || "trophy",
      title: `Achievement unlocked: ${a.name}`,
      text: a.desc,
      chip: `+${a.credits} credits`,
    });
  }

  // Grants an achievement once: records it, pays its credits, pops the alert.
  // Resolves false if it was already earned (nothing is paid twice).
  async function award(id) {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a || hasAchievement(id)) return false;
    writeJSON(ACH_KEY, { ...earned(), [id]: new Date().toISOString() });
    if (a.credits) record(a.credits, `Achievement: ${a.name}`);
    changed({ type: "achievement", id, amount: a.credits || 0 });
    announce(a);
    return true;
  }

  window.WS_Credits = {
    balance, history, achievements, hasAchievement, award, add, spend,
    unlockables, isUnlocked, unlock, hasPurchased, purchase,
    progress, noteRating, noteVisit,
  };
})();
