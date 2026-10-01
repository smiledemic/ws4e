"use strict";

const clamp    = (v, a = 0, b = 100) => Math.min(b, Math.max(a, v));
const delay    = (ms) => new Promise((r) => setTimeout(r, ms));
const safeStr  = (v) => (v == null ? "" : String(v));
const rafAsync = () => new Promise((r) => requestAnimationFrame(r));

function truncateText(text, max = 26) {
  text = safeStr(text);
  return text.length > max ? text.slice(0, max) + "..." : text;
}

// Asset-sheet "link" cells are meant to always be an external asset URL,
// but a bare domain like "ankomstudios.github.io./library/x/index.html"
// (no scheme) is indistinguishable from a relative path to a browser —
// window.open()/a.href would resolve it against the current page instead
// of treating it as external. Sheet data entry will keep making this
// mistake, so fix it here once rather than trusting every row to have
// typed "https://" — anything that already has a scheme (or is
// blob:/data:) passes through untouched.
function normalizeExternalLink(link) {
  const s = safeStr(link).trim();
  if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return `https://${s}`;
}

// Derives the local <name>/icon.png path a same-repo dev server would be
// able to serve for a given asset "link" (.../library/<name>/index.html),
// so the image loader has something to try before giving up to the
// generic placeholder — useful while icons are still being imported
// port-by-port and most don't have a hosted icon.png yet. Returns "" if
// the link doesn't match the expected shape.
//
// This page (index.html) lives one directory below the repo root, and
// every asset folder (1v1lol/, achievement-unlocked/, etc.) sits directly
// at that same repo root — there is no extra library/ folder in between
// here, unlike the deployed site's /library/<name>/ URL layout — so
// climbing out with "../" once lands directly on the asset folder.
function localIconFallback(link) {
  const m = safeStr(link).match(/\/library\/(.+\/)?index\.html?(?:[?#].*)?$/i);
  return m ? `../${m[1] || ""}icon.png` : "";
}

// Google's edge in front of Apps Script /exec deployments can serve a cached response
// regardless of the client's Cache-Control header, so `{cache:"no-store"}` alone isn't
// reliable for live-editable sheet endpoints. Appending a unique query string per request
// guarantees a cache miss everywhere (browser, proxy, and Google's own edge), since caches
// key on the full URL including the query string.
//
// Apps Script URLs also get this browser's access ticket (ticket.js) — the
// backend refuses every feed without an approved one.
function bustCache(url) {
  url = window.WS_Ticket ? window.WS_Ticket.withTicket(url) : url;
  return `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`;
}

// Resolves once this browser's ticket is approved (immediately if it already
// is). Await it before any Apps Script fetch — see ticket.js.
function ticketReady() {
  return window.WS_Ticket ? window.WS_Ticket.ready : Promise.resolve();
}

// Apps Script /exec deployments cold-start (the first hit after a quiet
// spell can take 10+ seconds) and occasionally bounce a request with a
// transient 5xx or a dropped connection. Every feed fetch used to be a
// single attempt, so that alone showed up as a real failure (crash screen
// for the assets, a stale quote box, …) even though the same request
// almost always succeeds on an immediate retry. This retries a GET as
// JSON up to `tries` times, each with its own timeout, backing off a bit
// between attempts; a 4xx (bad ticket, bad request, …) is treated as
// permanent and not retried, since trying again can't change the server's
// answer. `urlFactory` is called fresh for each attempt (rather than a
// plain url) so callers using bustCache() get a new cache-busting query
// string per try instead of the proxy/edge serving the same miss twice.
async function fetchJSONRetry(urlFactory, { tries = 3, timeoutMs = 10000, baseDelayMs = 600 } = {}) {
  const getUrl = typeof urlFactory === "function" ? urlFactory : () => urlFactory;
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(getUrl(), { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      const permanent = err?.status >= 400 && err.status < 500;
      if (permanent || attempt === tries - 1) throw err;
      await delay(baseDelayMs * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// Reads a field off a sheet-derived row object case/format-insensitively,
// so header text like "Category", "categories", or "Sub-Category" all match
// regardless of exact spelling used in the spreadsheet.
//
// Hot path: called for every row x every field, so normalized header keys are
// memoized (sheet rows all share the same few headers) instead of re-running
// lowercase + regex on every key of every row.
const _ciKeyCache = new Map();
function _ciNorm(s) {
  let n = _ciKeyCache.get(s);
  if (n === undefined) {
    n = String(s).toLowerCase().replace(/[\s_-]/g, "");
    _ciKeyCache.set(s, n);
  }
  return n;
}

function getFieldCI(row, ...names) {
  if (!row || typeof row !== "object") return "";
  for (const key in row) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const nk = _ciNorm(key);
    for (let i = 0; i < names.length; i++) {
      if (_ciNorm(names[i]) !== nk) continue;
      const v = row[key];
      if (v != null && String(v).trim()) return String(v);
      break;
    }
  }
  return "";
}

function fitInputText(el, text, { max = 14, min = 10, step = 0.5 } = {}) {
  if (!el) return;
  text = safeStr(text);

  if (!text) { el.style.fontSize = max + "px"; return; }

  const canvas = fitInputText._canvas || (fitInputText._canvas = document.createElement("canvas"));
  const ctx    = canvas.getContext("2d");
  const cs     = getComputedStyle(el);
  const available = el.clientWidth
    - (parseFloat(cs.paddingLeft)  || 0)
    - (parseFloat(cs.paddingRight) || 0);

  if (available <= 0) return;

  let size = max;
  while (size > min) {
    ctx.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    if (ctx.measureText(text).width <= available) break;
    size -= step;
  }
  el.style.fontSize = size + "px";
}

function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const _collator   = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const fastCompare = (a, b) => _collator.compare(a, b);

const getSortMode = () => localStorage.getItem("sortMode") || "sheet";

window.showToast = function showToast(message, timeout = 2200) {
  let t = document.getElementById("__ws_toast__");
  if (!t) {
    t = document.createElement("div");
    t.id = "__ws_toast__";
    Object.assign(t.style, {
      position:      "fixed",
      bottom:        "28px",
      left:          "50%",
      transform:     "translateX(-50%)",
      background:    "rgba(0,0,0,0.8)",
      color:         "#fff",
      padding:       "10px 14px",
      borderRadius:  "8px",
      fontFamily:    "monospace",
      zIndex:        "99999",
      opacity:       "0",
      transition:    "opacity 220ms ease",
      pointerEvents: "none",
    });
    document.body.appendChild(t);
  }
  clearTimeout(t.__timer);
  t.textContent   = message;
  t.style.opacity = "1";
  t.__timer = setTimeout(() => {
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 300);
  }, timeout);
};

const showToast = window.showToast;