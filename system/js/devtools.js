"use strict";

// ── Dev tools access ───────────────────────────────────────────────────
// Typing "debugplz!" anywhere on the site opens the debug panel
// (tools/debug.html) in a new tab, for contributors only. Everyone else gets
// nothing: no pop-up, no message.
//
// Who is a contributor lives in the DATA sheet "ContribWS" (TicketID |
// Username | Note), not in a file on the site. This browser asks the server
// (data.gs ?type=contrib, sent with its own ticket + secret key) and gets
// back only { listed: true|false }: the list itself is never sent to anyone.
// The server compares the listed username with the Name the ticket was
// created with, so copying someone's ticket id is not enough. The same answer
// also proves the ticket is approved with this browser's key.
// This only guards the shortcut and the panel's listing: the tool pages
// themselves are ordinary pages anyone could open by their URL.
//
// Speed: that is an Apps Script round trip (redirect + cold start, often
// seconds). A yes is remembered in localStorage (ws_dev_ok, tied to this
// ticket id + username) for TRUST_MS, so the panel opens instantly from the
// homepage's early check. The server is re-asked in the background once the
// memory is older than REVALIDATE_MS, and a definite "no" there forgets it and
// fires "ws:dev-revoked" on document (debug.html locks itself again).
//
// window.WS_Dev = { check() -> Promise<boolean>, open(), reason() -> why the last check said no }
(() => {
  const CODE  = "debugplz!";
  const BASE  = new URL("../tools/", document.currentScript?.src || location.href);
  const PANEL = new URL("debug.html", BASE).href;
  const OK_KEY        = "ws_dev_ok";
  const TRUST_MS      = 30 * 60 * 1000;
  const REVALIDATE_MS = 2 * 60 * 1000;

  const read = (k) => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } };
  const write = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (_) {} };

  // Age in ms of the remembered pass for this id+user, or -1 if none/stale.
  function passAge(id, user) {
    try {
      const m = JSON.parse(read(OK_KEY) || "null");
      if (!m || m.id !== id || m.user !== user) return -1;
      const age = Date.now() - Number(m.at);
      return age >= 0 && age < TRUST_MS ? age : -1;
    } catch (_) { return -1; }
  }
  const remember = (id, user) => write(OK_KEY, JSON.stringify({ id, user, at: Date.now() }));

  // Why the last check() said no, for debug.html to show:
  //   { code: "no-ticket" | "no-username" | "not-listed" | "server-status"
  //           | "server-unreachable", id, user, status? }
  let reason = null;
  const fail = (code, extra) => { reason = { code, ...extra }; return false; };

  // Asks the server whether this browser's ticket is a listed contributor.
  // Resolves { listed: true|false } on a real answer, { status } when the
  // ticket itself isn't approved ("pending", "unknown", "missing", ...), or
  // null when the server couldn't be reached.
  async function ask() {
    try {
      const res = await fetch(bustCache(`${window.WS_ENDPOINTS.data}?type=contrib`), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j && j.listed === true) return { listed: true };
      if (j && j.listed === false && !j.error) return { listed: false };
      if (j && j.ticket && j.error) return { status: String(j.ticket) };   // "Ticket required." + its status
      return null;
    } catch (_) { return null; }
  }

  let revalidating = false;
  function revalidate(id, user) {
    if (revalidating) return;
    revalidating = true;
    ask().then((a) => {
      if (a && a.listed) { remember(id, user); return; }
      if (!a) return;                       // unreachable: keep the pass until it expires
      write(OK_KEY, "");
      allowed = false;
      checking = null;
      if (a.status) fail("server-status", { id, user, status: a.status });
      else fail("not-listed", { id, user });
      document.dispatchEvent(new CustomEvent("ws:dev-revoked"));
    });
  }

  // ticket.js changed the ticket (new id, revoked, pending): forget the pass.
  document.addEventListener("ws:ticket-change", (e) => {
    if (e.detail?.status !== "approved") { write(OK_KEY, ""); allowed = false; checking = null; }
  });

  let checking = null;

  function check() {
    if (checking) return checking;
    checking = (async () => {
      reason = null;
      const id = read("ws_ticket_id").trim();
      const user = read("ws_username").trim().replace(/^@/, "").toLowerCase();
      if (!id) return fail("no-ticket", { id, user });
      if (!user) return fail("no-username", { id, user });
      const age = passAge(id, user);
      if (age >= 0) {
        if (age > REVALIDATE_MS) revalidate(id, user);
        return true;
      }
      const a = await ask();
      if (a && a.listed) { remember(id, user); return true; }
      if (!a) return fail("server-unreachable", { id, user });
      write(OK_KEY, "");
      return a.status ? fail("server-status", { id, user, status: a.status }) : fail("not-listed", { id, user });
    })();
    // A failed check (e.g. offline) can be tried again next time.
    checking.then((ok) => { if (!ok) checking = null; });
    return checking;
  }

  function open() { window.open(PANEL, "_blank", "noopener"); }

  // Check early, so the tab can open straight from the keystroke (a
  // pop-up opened after waiting on the network may get blocked).
  let allowed = false;
  const warm = () => check().then((ok) => { allowed = ok; });
  if (read("ws_ticket_id")) setTimeout(warm, 1500);

  let typed = "";
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-CODE.length);
    if (typed !== CODE) return;
    typed = "";
    if (allowed) { open(); return; }
    check().then((ok) => { allowed = ok; if (ok) open(); });
  }, true);

  window.WS_Dev = { check, open, reason: () => reason };
})();
