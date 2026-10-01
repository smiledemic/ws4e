"use strict";

// Nav toggle for DevBuild asset fetching. Toggling the button just arms
// the "F" hotkey — it does not fetch anything by itself. Pressing F while
// armed points window._activeFetchUrl at config.devBuildUrl (the
// ?type=devbuild route in data.gs, reading the DevBuildWS sheet
// instead of AssetBuilderWS) and reloads the asset feed from it.
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("devbuild-btn");
  if (!btn) return;

  const KEY = "ws_devBuildArmed";
  let armed = localStorage.getItem(KEY) === "true";

  function updateUI() {
    btn.classList.toggle("active", armed);
    btn.title = armed
      ? "DevBuild fetch armed — press F to fetch DevBuildWS data"
      : "Toggle DevBuild fetch (press F to apply)";
  }

  function toggle() {
    armed = !armed;
    localStorage.setItem(KEY, String(armed));
    updateUI();
    showToast(armed ? "🧪 DevBuild fetch armed — press F" : "DevBuild fetch off");
  }

  btn.addEventListener("click", toggle);
  updateUI();

  document.addEventListener("keydown", (e) => {
    if (!armed) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // don't steal Ctrl/Cmd+F
    if (e.key.toLowerCase() !== "f") return;

    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    e.preventDefault();

    const devBuildUrl = window.config?.devBuildUrl;
    if (!devBuildUrl) {
      showToast("No devBuildUrl configured.");
      return;
    }

    window._activeFetchUrl = devBuildUrl;
    showToast("🧪 Fetching DevBuildWS asset data…");

    if (typeof window.reloadAssets === "function") {
      window.reloadAssets().catch(() => showToast("DevBuild fetch failed."));
    }
  });
});
