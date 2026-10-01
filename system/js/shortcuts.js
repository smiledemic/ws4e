"use strict";

// ── Shortcuts panel ────────────────────────────────────────────────────
// Opened from "Shortcuts" in the ☰ menu. Styled to match the daily-picks
// pop-up (blurred polka-dot backdrop, tilted panel, sticker).
//
// window.WS_Shortcuts = { open(), close(), setBanner(html) }
// Fires "ws:shortcuts-open" / "ws:shortcuts-close" on document — the
// tutorial ends on the first open.
document.addEventListener("DOMContentLoaded", () => {
  const trigger = document.getElementById("openShortCuts");
  if (!trigger) return;

  const SHORTCUTS = [
    { keys: ["Esc"],             label: "Panic: jump to your saved panic URL" },
    { keys: ["T"],               label: "Cycle incognito mode (off, about, blob)" },
    { keys: ["R"],               label: "Refetch assets" },
    { keys: ["←", "→"],          label: "Previous / next page", joiner: " " },
    { keys: ["0"],               label: "Reset to the Redux theme" },
    { keys: ["1", "9"],          label: "Jump to one of your theme shortcuts", joiner: "–" },
    { keys: ["[", "]"],          label: "Cycle your gif packs (loading, searching, crash)", joiner: " " },
    { keys: ["+", "−"],          label: "Cycle your widgets", joiner: " " },
    { keys: ["\\"],             label: "Hide / show your widgets" },
  ];

  const kbd = (k) => `<kbd>${k}</kbd>`;
  const rows = SHORTCUTS.map((s, i) => `
    <li class="sc-row" style="--i:${i}">
      <span class="sc-keys">${s.keys.map(kbd).join(s.joiner ? `<span class="sc-join">${s.joiner}</span>` : "")}</span>
      <span class="sc-label">${s.label}</span>
    </li>`).join("");

  const overlay = document.createElement("div");
  overlay.className = "sc-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="sc-backdrop"></div>
    <div class="sc-panel" role="dialog" aria-modal="true" aria-labelledby="scTitle" tabindex="-1">
      <img class="sc-sticker" alt="" aria-hidden="true" />
      <button type="button" class="sc-close" aria-label="Close">✕</button>
      <div class="sc-scroll">
        <div class="sc-head">
          <h2 id="scTitle">Shortcuts</h2>
          <p class="sc-sub">Press these anywhere on the page, as long as you're not typing in a box.</p>
        </div>
        <div class="sc-banner" hidden></div>
        <ul class="sc-list">${rows}</ul>
        <div class="sc-note">
          <b>1–9</b>, <b>[ ]</b> and <b>+ −</b> do nothing until you pick something for them.
          Choose your theme shortcuts, gif packs and widgets in the
          <a href="system/pages/store/index.html" target="_blank" rel="noopener">Store</a>.
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const panel   = overlay.querySelector(".sc-panel");
  const banner  = overlay.querySelector(".sc-banner");
  const sticker = overlay.querySelector(".sc-sticker");
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let lastFocus = null;

  function randomSticker() {
    const man  = window.stickerManifest;
    const base = window.stickerBasePath || "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/main/stickers/";
    if (!man) return null;
    const keys = Object.keys(man);
    return keys.length ? base + man[keys[Math.floor(Math.random() * keys.length)]] : null;
  }

  const isOpen = () => overlay.classList.contains("is-open");

  function open() {
    if (isOpen()) return;
    const src = randomSticker();
    sticker.hidden = !src;
    if (src) sticker.src = src;

    lastFocus = document.activeElement;
    overlay.hidden = false;
    document.documentElement.classList.add("sc-lock");
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add("is-open")));
    panel.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent("ws:shortcuts-open"));
  }

  function close() {
    if (!isOpen()) return;
    overlay.classList.remove("is-open");
    document.documentElement.classList.remove("sc-lock");
    setTimeout(() => {
      if (!isOpen()) { overlay.hidden = true; banner.hidden = true; banner.innerHTML = ""; }
    }, reduceMotion?.matches ? 0 : 300);
    lastFocus?.focus?.({ preventScroll: true });
    document.dispatchEvent(new CustomEvent("ws:shortcuts-close"));
  }

  function setBanner(html) {
    banner.innerHTML = html || "";
    banner.hidden = !html;
  }

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    // Tuck the ☰ menu away so it isn't left hanging open behind the panel.
    const dash = document.getElementById("dashboardMenu");
    if (dash && dash.style.display === "block") document.getElementById("dashboardBtn")?.click();
    open();
  });
  overlay.querySelector(".sc-backdrop").addEventListener("click", close);
  overlay.querySelector(".sc-close").addEventListener("click", close);

  // Capture phase so Esc closes this instead of firing the panic redirect.
  document.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.key !== "Tab") return;
    const f = [...panel.querySelectorAll("button, a[href]")];
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);

  window.WS_Shortcuts = { open, close, setBanner };
});
