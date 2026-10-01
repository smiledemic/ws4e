"use strict";

// ── Word filter ────────────────────────────────────────────────────────
// Words/phrases nobody gets to use in a nickname or a ticket reason. The
// list lives in its own sheet + Apps Script project (see
// .documentation/api/mod.gs), deliberately separate from the main
// backend, and it's public: no ticket needed. The checks run here in the
// browser, before anything is sent. (That keeps ordinary visitors honest;
// it isn't a security boundary — someone sending requests by hand skips it,
// and you still approve tickets.)
//
// Sheet column A, row 1 = header, one entry per row:
//   plain       "bad phrase" -> blocked as a whole word/phrase only
//                               ("hell" blocks "hell", not "hello")
//   *wrapped*   "*slur*"     -> also blocked inside other words and through
//                               spacing/punctuation ("xXslurXx", "s.l.u.r")
// Case and punctuation are ignored either way.
//
// Loading never makes anyone wait on Apps Script (cold starts there can
// take 15s+, and it sometimes answers with an HTML error page):
//   - the list is kept in localStorage across visits, so after the first
//     visit it's ready instantly; it's refreshed in the background once it's
//     older than MAX_AGE_MS, and a failed refresh keeps the old list;
//   - this file loads in <head> and starts the fetch straight away;
//   - load() gives up waiting after WAIT_MS, but the fetch carries on and
//     the list applies the moment it lands (find() always uses the latest),
//     so a slow first visit is still filtered by the time anyone has typed
//     a nickname and a reason; one retry if the first attempt fails.
//
// TAKEN USERNAMES come from the same project (?type=usernames, its
// "UsernameListed" tab, which mirrors TicketApprovalWS's Name column), so
// "that username is taken" shows while someone types instead of after they
// submit. Only fetched for a browser without an approved ticket (nobody else
// is picking a username), never saved (the list changes as people join),
// and checked with the same "too similar" rule as the main backend's
// _ticketSkeleton/_ticketSimilar — which still re-checks on submit, since a
// browser check can be skipped and two people can pick at the same moment.
//
// window.WS_WordFilter = {
//   load() -> Promise (resolves once the list is in, or after WAIT_MS),
//   find(text) -> the entry it hits, or "" if it's clean,
//   loadUsernames() -> Promise (same waiting rules as load()),
//   usernameTaken(name) -> the existing username it's too close to, or "",
// }
(() => {
  // The word-filter project's /exec URL. Empty = filtering off.
  const FILTER_URL  = (window.WS_ENDPOINTS && window.WS_ENDPOINTS.mod) || "";   // endpoints.js
  // Tied to the URL so switching filter projects never reuses an old list.
  const STORE_KEY   = `ws_wordfilter:${FILTER_URL}`;
  const MAX_AGE_MS  = 10 * 60 * 1000; // refresh in the background after this
  const WAIT_MS     = 4000;           // longest load() holds anything up
  const RETRY_MS    = 3000;           // one retry this long after a failure

  let entries  = [];   // compiled [{ t, loose, raw }], always the latest
  let haveList = false;
  let inflight = null;

  const norm = (v) => String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  function compile(list) {
    const seen = new Set();
    const out = [];
    for (const raw0 of list) {
      const raw   = String(raw0 == null ? "" : raw0).trim();
      const loose = raw.length > 2 && raw.startsWith("*") && raw.endsWith("*");
      const term  = norm(loose ? raw.slice(1, -1) : raw);
      if (!term) continue;
      const e = loose ? { t: term.replace(/ /g, ""), loose: true, raw } : { t: term, loose: false, raw };
      const key = (loose ? "*" : "") + e.t;
      if (!seen.has(key)) { seen.add(key); out.push(e); }
    }
    return out;
  }

  // Same shape the quotes feed uses ({ "<A1 header>": [...] }); a plain
  // array is fine too. Anything else (an error object) -> null.
  function listFrom(json) {
    if (Array.isArray(json)) return json;
    if (json && typeof json === "object" && !json.error) {
      const arr = Object.values(json).find(Array.isArray);
      if (arr) return arr;
    }
    return null;
  }

  function use(list) {
    entries  = compile(list);
    haveList = true;
  }

  function readStore() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      return v && Array.isArray(v.list) ? v : null;
    } catch (_) { return null; }
  }

  function writeStore(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ at: Date.now(), list })); } catch (_) {}
  }

  // Fetches the list (one retry on failure). Resolves true/false; never throws.
  function refresh() {
    if (!FILTER_URL) return Promise.resolve(false);
    if (inflight) return inflight;
    const attempt = () =>
      fetch(`${FILTER_URL}${FILTER_URL.includes("?") ? "&" : "?"}_=${Date.now()}`, { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((json) => {
          const list = listFrom(json);
          if (!list) throw new Error(json?.error || "unexpected response");
          use(list);
          writeStore(list);
          return true;
        });
    inflight = attempt()
      .catch(() => new Promise((r) => setTimeout(r, RETRY_MS)).then(attempt))
      .catch((err) => {
        console.warn("[wordfilter] couldn't refresh the list:", err.message, haveList ? "(keeping the saved one)" : "");
        return false;
      })
      .finally(() => { inflight = null; });
    return inflight;
  }

  // Start right away: saved list first (instant), network only if needed.
  const saved = readStore();
  if (saved) use(saved.list);
  if (FILTER_URL && (!saved || Date.now() - saved.at > MAX_AGE_MS)) refresh();

  function load() {
    if (haveList || !FILTER_URL) return Promise.resolve(entries);
    const wait = new Promise((r) => setTimeout(r, WAIT_MS));
    return Promise.race([refresh(), wait]).then(() => entries);
  }

  function find(text) {
    if (!entries.length) return "";
    const n = norm(text);
    if (!n) return "";
    const spaced   = ` ${n} `;
    const squashed = n.replace(/ /g, "");
    for (const e of entries) {
      if (e.loose ? squashed.includes(e.t) : spaced.includes(` ${e.t} `)) return e.raw;
    }
    return "";
  }

  // ── Taken usernames ──────────────────────────────────────────────────
  // Keep in step with _ticketSkeleton / _ticketSimilar in data.gs.
  const SIMILAR_MIN = 6;
  const LOOKALIKE = { "0": "o", "1": "i", "l": "i", "|": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "8": "b", "9": "g" };

  function skeleton(v) {
    let out = "";
    for (const c0 of String(v == null ? "" : v).replace(/^'/, "").trim().toLowerCase()) {
      const c = LOOKALIKE[c0] || c0;
      if (c < "a" || c > "z") continue;
      if (out[out.length - 1] !== c) out += c;
    }
    return out;
  }

  function similar(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (Math.min(a.length, b.length) < SIMILAR_MIN || Math.abs(a.length - b.length) > 1) return false;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
        rowMin = Math.min(rowMin, cur[j]);
      }
      if (rowMin > 1) return false;
      prev = cur;
    }
    return prev[b.length] <= 1;
  }

  let taken = [];          // [{ raw, sk }]
  let takenLoaded = false;
  let takenInflight = null;

  function refreshUsernames() {
    if (!FILTER_URL) return Promise.resolve(false);
    if (takenInflight) return takenInflight;
    const attempt = () =>
      fetch(`${FILTER_URL}${FILTER_URL.includes("?") ? "&" : "?"}type=usernames&_=${Date.now()}`, { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((json) => {
          const list = listFrom(json);
          if (!list) throw new Error(json?.error || "unexpected response");
          taken = list.map((raw) => ({ raw: String(raw), sk: skeleton(raw) })).filter((u) => u.sk);
          takenLoaded = true;
          return true;
        });
    takenInflight = attempt()
      .catch(() => new Promise((r) => setTimeout(r, RETRY_MS)).then(attempt))
      .catch((err) => { console.warn("[wordfilter] couldn't load taken usernames:", err.message); return false; })
      .finally(() => { takenInflight = null; });
    return takenInflight;
  }

  function loadUsernames() {
    if (takenLoaded || !FILTER_URL) return Promise.resolve(taken);
    const wait = new Promise((r) => setTimeout(r, WAIT_MS));
    return Promise.race([refreshUsernames(), wait]).then(() => taken);
  }

  function usernameTaken(name) {
    const sk = skeleton(name);
    if (!sk) return "";
    const hit = taken.find((u) => similar(u.sk, sk));
    return hit ? hit.raw : "";
  }

  // Only someone still getting a ticket is picking a username.
  try {
    if (FILTER_URL && localStorage.getItem("ws_ticket_status") !== "approved") refreshUsernames();
  } catch (_) {}

  window.WS_WordFilter = { load, find, loadUsernames, usernameTaken };
})();
