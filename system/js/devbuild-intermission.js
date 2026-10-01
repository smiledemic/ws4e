"use strict";

// Must load and run BEFORE main.js. By the time main.js's own
// DOMContentLoaded handler reaches loadAssets(), window._activeFetchUrl
// has already been read — a script that only sets it from a later
// DOMContentLoaded listener (like devbuild.js's "F" hotkey) is always
// one fetch too late on page load, forcing a redundant first fetch
// against AssetBuilderWS before anyone gets a chance to redirect it.
//
// localStorage is available immediately, with no need to wait for the
// DOM — so this just reads the armed flag devbuild.js's toggle already
// persists and stashes it somewhere main.js can check once
// window.config actually exists (inside its own initElements()).
window._devBuildArmedAtLoad = localStorage.getItem("ws_devBuildArmed") === "true";
