"use strict";

// Same key themify.js declares as THEME_SHORTCUT_KEY — not reusing that
// name here since both files run as top-level classic scripts sharing one
// global scope, and a second `const` with the same name throws.
const UI_THEME_SHORTCUT_KEY = "ws_selected_themes"; // set by store.html: up to 9 theme ids, pick order

// Keys "1".."9" go to whatever the user picked in store.html's Themes
// section, in pick order; "0" always jumps back to redux as a safe,
// unconditional reset. Rebuilt on load and whenever the shortcut selection
// changes (including from another tab — see the storage listener below).
//
// No "R" entry here on purpose — the keydown handler below checks r/R for
// asset refetch first and always returns before this map is ever consulted,
// so a theme binding on that key could never actually fire.
function _buildThemeMap() {
  let selected;
  try { selected = JSON.parse(localStorage.getItem(UI_THEME_SHORTCUT_KEY) || "[]"); }
  catch (_) { selected = []; }
  if (!Array.isArray(selected)) selected = [];

  const map = { "0": "redux" };
  selected.slice(0, 9).forEach((id, i) => { map[String(i + 1)] = id; });
  return map;
}

window.THEME_MAP = _buildThemeMap();

const GIFPACK_SELECTION_KEY = "ws_selected_gifpacks"; // set by store.html: cycle order for [ / ]

// Steps the active gif pack through whatever set the user made available in
// store.html — independent of theme shortcuts entirely. No-ops if the user
// hasn't picked any packs to cycle through yet.
function _cycleGifPack(direction) {
  if (!window.GifPacks) return;

  let selected;
  try { selected = JSON.parse(localStorage.getItem(GIFPACK_SELECTION_KEY) || "[]"); }
  catch (_) { selected = []; }
  if (!Array.isArray(selected) || !selected.length) return;

  const active = window.GifPacks.getActive();
  const idx    = selected.indexOf(active);
  const next   = idx === -1
    ? (direction > 0 ? selected[0] : selected[selected.length - 1])
    : selected[(idx + direction + selected.length) % selected.length];

  if (window.GifPacks.setActive(next)) {
    showToast(`Gif pack → ${window.GifPacks.getName(next)}`);
  }
}

window.addEventListener("storage", (e) => {
  if (e.key === UI_THEME_SHORTCUT_KEY) window.THEME_MAP = _buildThemeMap();
});

function _applyTheme(keyOrName) {

  const mapped = window.THEME_MAP[keyOrName] || keyOrName;

  const theme  = (typeof _resolveTheme === "function") ? _resolveTheme(mapped) : mapped;
  document.documentElement.setAttribute("theme", theme);
  window.currentTheme = theme;
  localStorage.setItem("selectedTheme", theme);
  if (typeof _rememberThemeRow === "function") _rememberThemeRow(theme);

  if (theme === "custom") {
    try {
      const vars = JSON.parse(localStorage.getItem("customTheme") || "{}");
      if (typeof _applyCustomVars === "function") {
        _applyCustomVars(vars);
      } else {

        for (const [k, v] of Object.entries(vars)) {
          document.documentElement.style.setProperty(k, v);
        }
      }
    } catch (_) {}
  } else {

    document.documentElement.style.cssText = "";
  }

  if (typeof window.applyThemeGifs === "function") window.applyThemeGifs(theme);

  if (typeof window.setLoaderState === "function") {
    const loaderImg = document.querySelector("#containerLoader img");
    if (loaderImg) {
      const currentState = loaderImg.dataset.gifState || "loading";
      window.setLoaderState(currentState);
    }
  }
  return theme;
}

document.addEventListener("DOMContentLoaded", () => {
  const sheetOrderBtn   = document.getElementById("sheetOrderBtn");
  const alphabeticalBtn = document.getElementById("alphabeticalBtn");
  if (!sheetOrderBtn || !alphabeticalBtn) return;

  const updateButtons = (mode) => {
    sheetOrderBtn.classList.toggle("active",   mode === "sheet");
    alphabeticalBtn.classList.toggle("active", mode === "alphabetical");
  };

  updateButtons(getSortMode());

  const setSortMode = (mode) => {
    localStorage.setItem("sortMode", mode);
    updateButtons(mode);
    showToast(`Sort mode: ${mode === "sheet" ? "Sheet Order" : "Alphabetical"}`);
    document.dispatchEvent(new CustomEvent("sortModeChanged", { detail: mode }));
  };

  sheetOrderBtn.addEventListener("click",   () => setSortMode("sheet"));
  alphabeticalBtn.addEventListener("click", () => setSortMode("alphabetical"));
});

document.addEventListener("sortModeChanged", () => {
  if (window.assetsData && typeof window.refreshCards === "function") window.refreshCards();
});

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  if (e.key === "Escape") {
    const panicURL = localStorage.getItem("panicURL");
    if (panicURL) window.location.href = panicURL;
    return;
  }

  if (e.key === "r" || e.key === "R") {
    if (typeof window.reloadAssets !== "function") return;
    const now = Date.now();
    if (window._reloading) {
      showToast("Already refreshing, idoit...");
    } else if (now < (window._reloadCooldownUntil || 0)) {
      showToast(`Cooldown: ${Math.ceil((window._reloadCooldownUntil - now) / 1000)}s remaining`);
    } else {
      showToast("Re-fetching assets...");
      const toHide = window._allCards?.length
        ? window._allCards
        : [...document.querySelectorAll(".asset-card")];
      toHide.forEach(c => { c.style.display = "none"; });
      window.reloadAssets()
        .then(ok => { if (ok) showToast("Assets reloaded!"); })
        .catch(() => showToast("Reload failed — check connection."));
    }
    return;
  }

  if (e.key === "t" || e.key === "T") {
    const modes   = ["off", "about", "blob"];
    const current = localStorage.getItem("incognitoMode") || "off";
    const next    = modes[(modes.indexOf(current) + 1) % modes.length];
    localStorage.setItem("incognitoMode", next);
    const indicator = document.getElementById("incognitoIndicator");
    const labels    = { off: null, about: "about:blank mode", blob: "blob:null mode" };
    const msgs      = {
      off:   "Normal mode — standard new tab",
      about: "Incognito: about:blank mode",
      blob:  "Incognito: blob:null mode — switched mode: blobNull system",
    };
    showToast(msgs[next]);
    if (indicator) {
      if (next === "off") { indicator.classList.remove("show"); }
      else { indicator.textContent = labels[next]; indicator.classList.add("show"); }
    }
    return;
  }

  if (e.key === "[" || e.key === "]") {
    e.preventDefault();
    _cycleGifPack(e.key === "]" ? 1 : -1);
    return;
  }

  if (window.THEME_MAP[e.key] !== undefined) {
    const theme = _applyTheme(e.key);
    const label = window.ThemifySheets?.getCachedThemeName?.(theme) || theme;
    showToast(`Theme → ${label}`);
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const popup         = document.getElementById("updatePopup");
  const video         = document.getElementById("updateVideo");
  const closeBtn      = document.getElementById("closeUpdateBtn");
  const viewUpdateBtn = document.getElementById("viewUpdateBtn");
  const viewInfoBtn   = document.getElementById("viewUpdateInfoBtn");
  const dontShowBtn   = document.getElementById("dontShowBtn");
  const dashboardMenu = document.getElementById("dashboardMenu");
  const dashboardBtn  = document.getElementById("dashboardBtn");
  const toTopBtn      = document.getElementById("toTopBtn");
  const pfp           = document.getElementById("pfp");

  function stopVideo() {
    if (!video) return;
    const src = video.src; video.src = ""; video.src = src;
  }

  function closePopup() {
    if (!popup) return;
    popup.classList.remove("show");
    sessionStorage.setItem("updatePopupClosed", "true");
    stopVideo();
  }

  if (popup) {
    closeBtn?.addEventListener("click", closePopup);
    dontShowBtn?.addEventListener("click", () => {
      const version = document.getElementById("footerVersion")
        ?.textContent?.replace("Version ", "").trim() || "v0.8";
      localStorage.setItem("dismissedUpdateVersion", version);
      closePopup();
    });
    viewUpdateBtn?.addEventListener("click", () => window.open("updates.html",     "_blank"));
    viewInfoBtn?.addEventListener("click",   () => window.open("update-info.html", "_blank"));
  }

  // Appends "(shortSha)" to the footer label from the live repo's latest
  // main-branch commit, and makes the label link to that commit on GitHub.
  // Cached in sessionStorage briefly so repeat navigations within the same
  // tab don't hit the GitHub API's unauthenticated rate limit needlessly.
  (function loadLatestCommitLabel() {
    const el = document.getElementById("footerVersion");
    if (!el) return;

    const REPO      = "wannasmile4evr/wannasmile4evr.github.io";
    const CACHE_KEY = "ws_latest_commit_cache";
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const baseLabel = el.textContent.trim();

    const applyCommit = (sha, htmlUrl) => {
      el.textContent = `${baseLabel} (${sha.slice(0, 7)})`;
      el.href   = htmlUrl;
      el.target = "_blank";
      el.rel    = "noopener noreferrer";
    };

    let cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null"); } catch (_) {}
    if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
      applyCommit(cached.sha, cached.htmlUrl);
      return;
    }

    fetch(`https://api.github.com/repos/${REPO}/commits/main`)
      .then((res) => { if (!res.ok) throw new Error(`GitHub API ${res.status}`); return res.json(); })
      .then((data) => {
        if (!data || !data.sha || !data.html_url) return;
        applyCommit(data.sha, data.html_url);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({
            sha: data.sha, htmlUrl: data.html_url, time: Date.now(),
          }));
        } catch (_) {}
      })
      .catch((err) => console.warn("[footer-version] failed to fetch latest commit:", err));
  })();

  if (dashboardBtn && dashboardMenu) {
    dashboardMenu.style.display    = "none";
    dashboardMenu.style.opacity    = "0";
    dashboardMenu.style.transition = "opacity 0.3s ease, transform 0.3s ease";

    const toggleDashboard = (e) => {
      e.stopPropagation();
      const isVisible = dashboardMenu.style.display === "block";
      if (isVisible) {
        dashboardMenu.style.opacity = "0";
        dashboardBtn.setAttribute("aria-expanded",  "false");
        dashboardMenu.setAttribute("aria-hidden",   "true");
        setTimeout(() => (dashboardMenu.style.display = "none"), 300);
      } else {
        dashboardMenu.style.display = "block";
        dashboardBtn.setAttribute("aria-expanded",  "true");
        dashboardMenu.setAttribute("aria-hidden",   "false");
        setTimeout(() => (dashboardMenu.style.opacity = "1"), 10);
      }
    };

    dashboardBtn.addEventListener("click", toggleDashboard);
    document.addEventListener("click", (e) => {
      if (
        dashboardMenu.style.display === "block" &&
        !dashboardMenu.contains(e.target) &&
        e.target !== dashboardBtn
      ) toggleDashboard(e);
    });
  }

  if (toTopBtn) {
    toTopBtn.style.position = "fixed";
    toTopBtn.style.zIndex   = "999999";

    const updateVisibility = () => {
      const y = document.body.scrollTop || document.documentElement.scrollTop;
      toTopBtn.style.display = y > 200 ? "block" : "none";
    };

    window.addEventListener("scroll", updateVisibility, { passive: true });
    toTopBtn.addEventListener("click",    () => window.scrollTo({ top: 0, behavior: "smooth" }));
    toTopBtn.addEventListener("dblclick", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    updateVisibility();
  }

  if (pfp) {
    const saved = localStorage.getItem("profilePic");
    if (saved && pfp.src !== saved) pfp.src = saved;
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const dlBtn = document.getElementById("downloadBtn");
  if (!dlBtn) return;

  dlBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const blob = new Blob(
      ["<!DOCTYPE html>\n" + document.documentElement.outerHTML],
      { type: "text/html;charset=utf-8" }
    );
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement("a"), { href: url, download: "wnasmilev08.html" });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
});

document.addEventListener("DOMContentLoaded", () => {
  const overlay    = document.getElementById("welcomeOverlay");
  const dismissBtn = document.getElementById("welcomeDismiss");
  const neverBtn   = document.getElementById("welcomeNeverShow");
  const indicator  = document.getElementById("incognitoIndicator");

  const savedMode = localStorage.getItem("incognitoMode") || "off";
  if (indicator && savedMode !== "off") {
    indicator.textContent = savedMode === "blob" ? "blob:null mode" : "about:blank mode";
    indicator.classList.add("show");
  }

  const neverShow        = localStorage.getItem("welcomeNeverShow");
  const shownThisSession = sessionStorage.getItem("welcomeShown");
  if (!neverShow && !shownThisSession && overlay) {
    sessionStorage.setItem("welcomeShown", "true");
    const d = sessionStorage.getItem("introPlayed") ? 300 : 9000;
    setTimeout(() => overlay.classList.add("show"), d);
  }

  const hideOverlay = () => overlay?.classList.remove("show");
  dismissBtn?.addEventListener("click", hideOverlay);
  neverBtn?.addEventListener("click", () => {
    localStorage.setItem("welcomeNeverShow", "true");
    hideOverlay();
  });
  overlay?.addEventListener("click", (e) => { if (e.target === overlay) hideOverlay(); });
});