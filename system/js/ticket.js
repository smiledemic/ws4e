"use strict";

// ── Access tickets ─────────────────────────────────────────────────────
// Nothing is fetched from the Apps Script backend until this browser holds
// an approved ticket from the TicketApprovalWS sheet. The server enforces it
// (every feed except ?type=build / ?type=ticket needs &ticket=<approved id>,
// see .documentation/api/data.gs).
//
// This file is the ticket *state*: storage, the request/status calls, and
// WS_Ticket.ready, which every GS fetch awaits (bustCache() in utils.js adds
// &ticket=<id>&key=<key> to GS URLs).
//
// Every ticket has a secret key (24 random chars) issued with it. The server
// only accepts the id together with its key, so the id on its own (shown in
// the ☰ menu) is safe to share, and guessing ids gets nowhere. The key never
// appears on screen: it lives in localStorage and in the exported data file
// (ExportData.ws), which is the only way to bring a ticket to another
// browser — there's no "type your ticket id" box. Tickets from before keys
// existed (blank Key cell) still work by id alone. The *screens* live in
// the tutorial (tutorial.js).
//
// USERNAME vs NICKNAME: the ticket is created under a USERNAME — unique
// (the server refuses anything too close to an existing one), 3-20 of
// A-Z a-z 0-9 _ . -, and permanent: it's the ticket's Name in the sheet and
// never changes. The NICKNAME is just an optional display name (profile.js)
// set afterwards; with none, the username is shown. The username is kept in
// localStorage ws_username and travels with the ticket in the data file.
//
// One ticket per person: requests carry a random per-browser client id (the
// server hands a repeat request the same ticket back and refuses a name
// that already has one), and once this browser has asked (ws_ticket_requested)
// the tutorial never offers the request form again. The first 50 tickets
// ever are approved on the spot by the server. (Bad words in the name or
// reason are caught in the browser before sending — see wordfilter.js.)
//
// Load right after utils.js and before anything that fetches.
//
// window.WS_Ticket = {
//   ready (Promise), id(), status(), approved(), asked(), withTicket(url),
//   username() -> this ticket's username ("" if unknown, e.g. pre-username tickets)
//   request({ name, reason }) -> { ok, ticket, key, name, status }
//                              | { ok:false, code:"name_taken"|"bad_name"|"bad_reason", error }
//   (`reason` is "grade|name|role|paragraph" — built by the tutorial)
//   info() -> true/false: are new tickets still auto-approved? (null if unknown)
//   check() -> "approved" | "pending" | "denied" | "unknown"
//     (Status cells like "rejected", "banned" or "no" count as denied;
//     any other unrecognised word as pending. See normalize().)
//   verify(id, key) -> same, for a ticket from a data file; stores nothing
//   revoke(status) -> new ready promise (fires "ws:ticket-gate")
// }
// Fires "ws:ticket-change" on document whenever the id/status changes.
(() => {
  const API_URL    = window.WS_ENDPOINTS.data;   // endpoints.js (DATA issues tickets)
  const ID_KEY     = "ws_ticket_id";
  const SECRET_KEY = "ws_ticket_key";       // the ticket's secret key (never shown)
  const STATUS_KEY = "ws_ticket_status";
  const CLIENT_KEY = "ws_ticket_client";    // random per-browser id sent with the request
  const ASKED_KEY  = "ws_ticket_requested"; // "1" once this browser has sent its one request
  const USER_KEY   = "ws_username";         // the ticket's permanent username

  const read  = (k) => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } };
  const write = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (_) {} };

  const id       = () => read(ID_KEY);
  const status   = () => read(STATUS_KEY);
  const secret   = () => read(SECRET_KEY);
  const approved = () => !!id() && status() === "approved";
  const asked    = () => read(ASKED_KEY) === "1";
  const username = () => read(USER_KEY);

  let resolveReady;
  const newReady = () => new Promise((r) => { resolveReady = r; });

  function changed() {
    document.dispatchEvent(new CustomEvent("ws:ticket-change", { detail: { id: id(), status: status() } }));
  }

  function setState(ticketId, st, key) {
    if (ticketId !== undefined) write(ID_KEY, ticketId);
    if (key !== undefined) write(SECRET_KEY, key);
    write(STATUS_KEY, st);
    if (st === "approved") resolveReady();
    changed();
  }

  function clientId() {
    let c = read(CLIENT_KEY);
    if (!c) {
      c = crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      write(CLIENT_KEY, c);
    }
    return c;
  }

  function withTicket(url) {
    const t = id();
    if (!t || !/script\.google(usercontent)?\.com/.test(url) || /[?&]ticket=/.test(url)) return url;
    const k = secret();
    return `${url}${url.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(t)}${k ? `&key=${encodeURIComponent(k)}` : ""}`;
  }

  async function api(params, body) {
    const qs  = new URLSearchParams({ ...params, _: Date.now() }).toString();
    // No Content-Type header on the POST: a text/plain body is a "simple"
    // request, so there's no CORS preflight (Apps Script can't answer one).
    const res = await fetch(`${API_URL}?${qs}`, body
      ? { method: "POST", body: JSON.stringify(body), cache: "no-store" }
      : { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // `name` is the username. Throws on network trouble; a taken or badly
  // formed username comes back as { ok:false, code }.
  async function request({ name, reason }) {
    const res = await api({}, { type: "ticket", name, reason, client: clientId() });
    if (res?.code === "name_taken" || res?.code === "bad_name" || res?.code === "bad_reason") return res;
    if (!res?.ok || !res.ticket) throw new Error(res?.error || "No ticket came back.");
    write(ASKED_KEY, "1");
    // The server's copy wins (a repeat request gets the original username).
    write(USER_KEY, res.name || name);
    // res.existing: this browser had already asked — same ticket, no new row.
    res.status = normalize(res.status);
    setState(res.ticket, res.status === "approved" || res.status === "denied" ? res.status : "pending", res.key || "");
    return res;
  }

  // Whether a new ticket would be approved on the spot (the first-50 rule).
  // The tutorial uses it to pick the order: profile first while it's true,
  // ticket first once it isn't. null = couldn't tell (old backend/offline).
  async function info() {
    try {
      const res = await api({ type: "ticketinfo" });
      return typeof res?.autoApprove === "boolean" ? res.autoApprove : null;
    } catch (_) {
      return null;
    }
  }

  // The server passes a ticket's Status cell through as typed (only
  // approved/accepted are turned into "approved"), so the words are sorted
  // here: any of DENY_WORDS means denied, "unknown"/"missing" (no such
  // ticket) stay as they are, and anything else is still waiting.
  const DENY_WORDS = new Set([
    "denied", "deny", "rejected", "reject", "declined", "decline", "refused", "refuse",
    "banned", "ban", "blocked", "block", "revoked", "revoke", "removed", "no",
  ]);
  function normalize(st) {
    const s = String(st == null ? "" : st).trim().toLowerCase();
    if (s === "approved" || s === "accepted") return "approved";
    if (s === "unknown" || s === "missing") return s;
    if (DENY_WORDS.has(s)) return "denied";
    return "pending";
  }

  async function lookup(ticketId, key) {
    const res = await api({ type: "ticket", id: ticketId, ...(key ? { key } : {}) });
    return res?.status ? normalize(res.status) : "unknown";
  }

  async function check() {
    if (!id()) return "unknown";
    const st = await lookup(id(), secret());
    if (st === "approved" || st === "pending" || st === "denied") setState(undefined, st);
    return st;
  }

  // A ticket from an uploaded data file, checked before anything from the
  // file is saved. Wrong key and unknown id look identical ("unknown").
  function verify(ticketId, key) {
    return ticketId ? lookup(String(ticketId).trim(), String(key || "").trim()) : Promise.resolve("unknown");
  }

  // The server refused a stored "approved" ticket (revoked/removed in the
  // sheet): forget the approval, hand out a new promise, and ask the
  // tutorial to put its ticket screen back up.
  function revoke(st) {
    st = normalize(st);
    if (st === "unknown" || st === "missing") { write(ID_KEY, ""); write(STATUS_KEY, ""); write(SECRET_KEY, ""); write(USER_KEY, ""); }
    else write(STATUS_KEY, st === "denied" ? "denied" : "pending");
    window.WS_Ticket.ready = newReady();
    changed();
    document.dispatchEvent(new CustomEvent("ws:ticket-gate"));
    return window.WS_Ticket.ready;
  }

  // ── ☰ menu: nickname on the left, ticket id on the right (#dashIdRow) ──
  function paintDashboard() {
    const el = document.getElementById("dashTicketId");
    if (!el) return;
    const t = id();
    el.textContent = t || "no ticket";
    el.classList.toggle("is-empty", !t);
    el.title = !t ? "No access ticket yet"
             : approved() ? "Your ticket id (click to copy)"
             : `Your ticket id: ${status() || "pending"} (click to copy)`;
  }

  document.addEventListener("ws:ticket-change", paintDashboard);
  document.addEventListener("DOMContentLoaded", () => {
    paintDashboard();
    const idEl = document.getElementById("dashTicketId");
    idEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); idEl.click(); }
    });
    idEl?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation(); // keep the ☰ menu open
      const t = id();
      if (!t) return;
      navigator.clipboard?.writeText(t).then(() => {
        if (typeof showToast === "function") showToast("🎟️ Ticket id copied");
      }).catch(() => {});
    });
  });

  const ready = newReady();
  if (approved()) resolveReady();

  window.WS_Ticket = { ready, id, status, approved, asked, username, withTicket, request, info, check, verify, revoke, normalize };
})();
