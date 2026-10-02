"use strict";

// "Updates & changes" announcement modal — shows on every page init until
// dismissed per visitor (ws_updates_seen, see data.js), until a future
// update bumps UPDATE_ID, so an old dismissal never suppresses the next
// one. "Tell me all about it!" opens the news page and counts as
// dismissing it too; the backdrop/Escape close it for this viewing only,
// without marking it seen.
(() => {
  const UPDATE_ID = "2026-10-20pages";
  const SEEN_KEY  = "ws_updates_seen";

  const overlay = document.getElementById("updatesOverlay");
  const panel   = document.getElementById("updatesPanel");
  if (!overlay || !panel) return;

  // Site root from this script's own URL, so the news-page link resolves
  // the same whether this runs from the root page or a nested one.
  const root     = new URL("../../", document.querySelector("script[src*='js/updates.js']")?.src || location.href);
  const newsHref = new URL("system/pages/news/index.html", root).href;

  const seen     = () => { try { return localStorage.getItem(SEEN_KEY); } catch (_) { return null; } };
  const markSeen = () => { try { localStorage.setItem(SEEN_KEY, UPDATE_ID); } catch (_) {} };

  function close() {
    overlay.classList.remove("visible");
    setTimeout(() => { overlay.hidden = true; }, 200);
  }

  function open() {
    overlay.hidden = false;
    requestAnimationFrame(() => {
      overlay.classList.add("visible");
      panel.focus({ preventScroll: true });
    });
  }

  document.getElementById("updatesBackdrop")?.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("visible")) close();
  });

  document.getElementById("updatesDismiss")?.addEventListener("click", () => {
    markSeen();
    close();
  });

  document.getElementById("updatesReadMore")?.addEventListener("click", () => {
    markSeen();
    window.location.href = newsHref;
  });

  document.getElementById("openUpdates")?.addEventListener("click", (e) => {
    e.preventDefault();
    open();
  });

  if (seen() !== UPDATE_ID) open();
})();
