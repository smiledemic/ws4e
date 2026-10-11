"use strict";

// ── WannaChat ──────────────────────────────────────────────────────────
// Friends + direct messages for people who already have an access ticket.
//
//  • No login of its own and no exported data file: the page reads the
//    ticket this browser already holds (ticket.js: ws_ticket_id / key /
//    status / ws_username) and the Apps Script works out the real username
//    from that ticket, so nobody can chat as somebody else.
//  • Talks only to the DATA Apps Script (window.WS_ENDPOINTS.data, see
//    data.gs "WannaChat"): GET ?type=chat to read, POST { type:"chat" } to
//    act. No websocket; the page polls, and an idle poll is a tiny cached
//    answer ("unchanged"). The optional websocket worker lives in
//    documentation/websocket/ and is not used here.
//  • Friend requests: send → they Accept (or Decline) → then you can chat.
//    The newest 60 messages per friendship are kept; older ones are deleted
//    by the server as new ones arrive.
(() => {
  const $ = (id) => document.getElementById(id);
  const API = window.WS_ENDPOINTS && window.WS_ENDPOINTS.data;

  const K = { id: "ws_ticket_id", key: "ws_ticket_key", status: "ws_ticket_status", user: "ws_username", seen: "ws_chat_seen" };
  const read = (k) => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } };
  const NAME_RE  = /^[a-z0-9][a-z0-9_.\-]{2,19}$/;
  const MAX_TEXT = 500;
  const POLL_MS  = 5000;      // tab in front
  const SLOW_MS  = 30000;     // tab hidden
  const MAX_BACKOFF = 60000;

  const state = {
    me: "", friends: [], active: "", messages: [], rev: "", max: 60,
    loading: false, again: false, fails: 0, timer: 0, dead: false, sending: false,
  };

  const toast = (m) => (window.showToast ? window.showToast(m, 3200) : console.log(m));
  const cleanName = (v) => String(v || "").trim().replace(/^@/, "").toLowerCase();

  // Same small DOM helper everywhere; all user text goes in through
  // textContent, never innerHTML.
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const k in props || {}) {
      if (k === "class") n.className = props[k];
      else if (k === "text") n.textContent = props[k];
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), props[k]);
      else if (props[k] !== false && props[k] != null) n.setAttribute(k, props[k] === true ? "" : props[k]);
    }
    for (const c of kids) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  }
  const icon = (cls) => el("i", { class: cls, "aria-hidden": "true" });

  // ── seen-markers (unread dots), per browser ───────────────────────────
  const seen = () => { try { const v = JSON.parse(read(K.seen) || "{}"); return v && typeof v === "object" ? v : {}; } catch (_) { return {}; } };
  const markSeen = (name, ts) => {
    if (!name || !ts) return;
    const s = seen();
    if ((s[name] || 0) >= ts) return;
    s[name] = ts;
    try { localStorage.setItem(K.seen, JSON.stringify(s)); } catch (_) {}
  };

  // ── network ───────────────────────────────────────────────────────────
  const creds = () => ({ ticket: read(K.id), key: read(K.key) });

  async function get(extra) {
    const qs = new URLSearchParams({ type: "chat", ...creds(), ...extra, _: Date.now() });
    const res = await fetch(`${API}?${qs}`, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function post(action, extra) {
    // No Content-Type header: a text/plain body is a "simple" request, so
    // there's no CORS preflight (Apps Script can't answer one).
    const res = await fetch(API, {
      method: "POST", cache: "no-store",
      body: JSON.stringify({ type: "chat", action, ...creds(), ...extra }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  // ── status / gate ─────────────────────────────────────────────────────
  function net(kind, text) {
    const s = $("net");
    s.className = "status " + kind;
    s.textContent = text;
  }

  function gate(title, text, linkText) {
    state.dead = true;
    clearTimeout(state.timer);
    $("app").hidden = true;
    $("gate").hidden = false;
    $("gateTitle").textContent = title;
    $("gateText").textContent = text;
    if (linkText) $("gateBtn").lastChild.textContent = " " + linkText;
    net("off", "Unavailable");
  }

  // ── polling ───────────────────────────────────────────────────────────
  function schedule() {
    clearTimeout(state.timer);
    if (state.dead) return;
    const base = document.hidden ? SLOW_MS : POLL_MS;
    const wait = Math.min(MAX_BACKOFF, base * Math.pow(2, Math.min(state.fails, 4)));
    state.timer = setTimeout(() => refresh(false), wait);
  }

  async function refresh(force) {
    if (state.dead) return;
    if (state.loading) { if (force) state.again = true; return; }
    state.loading = true;
    try {
      const data = await get({ with: state.active, rev: force ? "" : state.rev });
      state.fails = 0;

      if (!data || data.ok !== true) {
        // An older data.gs doesn't know ?type=chat and answers with the
        // assets list instead.
        if (Array.isArray(data) || (data && Array.isArray(data.items)) || (data && !data.code && !data.error)) {
          return gate("Chat isn't switched on yet", "The data script hasn't been updated for WannaChat. Redeploy data.gs (WS-DATA-06 or newer) and reload this page.", "Back to WannaSmile");
        }
        if (data && data.code === "ticket") {
          return gate("Your ticket can't chat", "Chat needs your own approved access ticket, with its key. If you moved browsers, re-import your data on WannaSmile first.", "Back to WannaSmile");
        }
        if (data && data.error === "Ticket required.") {
          return gate("Sign in first", "This browser's ticket isn't approved (or was removed). Open WannaSmile and finish the ticket step.", "Go to WannaSmile");
        }
        throw new Error((data && data.error) || "Unexpected reply");
      }

      state.me = data.me || state.me;
      paintMe();
      state.rev = data.rev || state.rev;
      net("live", "Live");
      if (data.unchanged) return;

      state.max = data.max || 60;
      state.friends = Array.isArray(data.friends) ? data.friends : [];
      if (state.active && !state.friends.some((f) => f.name === state.active && f.status === "friend")) {
        state.active = "";        // removed (by either of you) or never accepted
        state.messages = [];
      } else if (state.active && data.with === state.active) {
        state.messages = data.messages || [];
        const last = state.messages[state.messages.length - 1];
        if (last) markSeen(state.active, last.ts);
      }
      renderFriends();
      renderConversation();
    } catch (err) {
      state.fails++;
      net("off", "Offline");
    } finally {
      state.loading = false;
      if (state.again) { state.again = false; refresh(true); }
      else schedule();
    }
  }

  // ── actions ───────────────────────────────────────────────────────────
  async function act(action, extra, okMsg) {
    try {
      const r = await post(action, extra);
      if (!r || r.ok !== true) throw new Error((r && r.error) || "That didn't work.");
      if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg);
    } catch (err) {
      toast(err.message || "That didn't work.");
    }
    refresh(true);
  }

  $("addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("addName");
    const name = cleanName(input.value);
    if (!NAME_RE.test(name)) return toast("Usernames are 3-20 letters, numbers, _ . or -");
    if (name === state.me) return toast("That's you!");
    $("addBtn").disabled = true;
    try {
      const r = await post("request", { to: name });
      if (!r || r.ok !== true) throw new Error((r && r.error) || "Couldn't send that request.");
      input.value = "";
      toast(r.state === "friend" ? `You and @${name} are friends now` : r.state === "outgoing" ? `Request sent to @${name}` : "Done");
    } catch (err) {
      toast(err.message || "Couldn't send that request.");
    } finally {
      $("addBtn").disabled = false;
      refresh(true);
    }
  });

  function open(name) {
    state.active = name;
    state.messages = [];
    state.rev = "";
    $("chat").classList.add("open");
    renderFriends();
    renderConversation();
    refresh(true);
    $("msg").focus({ preventScroll: true });
  }

  $("backBtn").addEventListener("click", () => {
    state.active = "";
    state.rev = "";
    $("chat").classList.remove("open");
    renderFriends();
    renderConversation();
  });

  $("removeBtn").addEventListener("click", () => {
    const name = state.active;
    if (!name) return;
    if (!window.confirm(`Remove @${name}? This also deletes your chat with them.`)) return;
    state.active = "";
    $("chat").classList.remove("open");
    act("remove", { name }, `Removed @${name}`);
  });

  async function send() {
    const box = $("msg");
    const text = box.value.trim();
    if (!text || !state.active || state.sending) return;
    state.sending = true;
    const to = state.active;
    box.value = "";
    updateCount();
    autosize();
    const tmp = { from: state.me, text, ts: Date.now(), pending: true };
    state.messages.push(tmp);
    renderThread(true);
    try {
      const r = await post("send", { to, text });
      if (!r || r.ok !== true) throw new Error((r && r.error) || "Couldn't send that.");
    } catch (err) {
      state.messages = state.messages.filter((m) => m !== tmp);
      if (!box.value) box.value = text;
      updateCount();
      renderThread(false);
      toast(err.message || "Couldn't send that.");
    } finally {
      state.sending = false;
      refresh(true);
    }
  }

  $("composer").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  $("msg").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $("msg").addEventListener("input", () => { updateCount(); autosize(); });

  function updateCount() { $("left").textContent = String(MAX_TEXT - $("msg").value.length); }
  function autosize() {
    const t = $("msg");
    t.style.height = "auto";
    t.style.height = Math.min(120, t.scrollHeight) + "px";
  }

  // ── rendering ─────────────────────────────────────────────────────────
  function paintMe() {
    if (!state.me) return;
    $("meName").textContent = "@" + state.me;
    $("meAvatar").textContent = state.me.charAt(0);
  }

  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dayKey = (ts) => new Date(ts).toDateString();
  function fmtDay(ts) {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return "Today";
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  }

  function renderFriends() {
    const list = $("list");
    list.textContent = "";
    const incoming = state.friends.filter((f) => f.status === "incoming");
    const friends  = state.friends.filter((f) => f.status === "friend");
    const outgoing = state.friends.filter((f) => f.status === "outgoing");
    const s = seen();

    if (incoming.length) {
      list.append(el("div", { class: "group", text: `Requests (${incoming.length})` }));
      for (const f of incoming) {
        list.append(el("div", { class: "row" },
          el("span", { class: "nm", text: "@" + f.name }),
          el("button", { class: "btn sm", type: "button", title: "Accept", "aria-label": "Accept " + f.name, onclick: () => act("accept", { from: f.name }, `You and @${f.name} are friends now`) }, icon("fa-solid fa-check")),
          el("button", { class: "btn ghost sm", type: "button", title: "Decline", "aria-label": "Decline " + f.name, onclick: () => act("decline", { from: f.name }) }, icon("fa-solid fa-xmark"))
        ));
      }
    }

    list.append(el("div", { class: "group", text: "Friends" }));
    if (!friends.length) {
      list.append(el("div", { class: "empty", text: incoming.length ? "Accept a request to start chatting." : "No friends yet. Add someone by their username above." }));
    }
    for (const f of friends) {
      const unread = f.last && f.last.from !== state.me && f.last.ts > (s[f.name] || 0) && f.name !== state.active;
      const preview = f.last ? (f.last.from === state.me ? "You: " : "") + f.last.text : "No messages yet";
      list.append(el("button", { class: "row friend" + (f.name === state.active ? " on" : ""), type: "button", onclick: () => open(f.name) },
        el("span", { class: "tx" }, el("span", { class: "nm", text: "@" + f.name, style: "display:block" }), el("span", { class: "pv", text: preview })),
        unread ? el("span", { class: "dot", title: "New message" }) : null
      ));
    }

    if (outgoing.length) {
      list.append(el("div", { class: "group", text: "Sent requests" }));
      for (const f of outgoing) {
        list.append(el("div", { class: "row" },
          el("span", { class: "nm", text: "@" + f.name }),
          el("span", { class: "pv", style: "font-size:.7rem;opacity:.6", text: "waiting" }),
          el("button", { class: "btn ghost sm", type: "button", title: "Cancel request", "aria-label": "Cancel request to " + f.name, onclick: () => act("cancel", { to: f.name }, "Request cancelled") }, icon("fa-solid fa-xmark"))
        ));
      }
    }
  }

  function renderConversation() {
    const on = !!state.active;
    $("idle").hidden = on;
    $("convBody").hidden = !on;
    if (!on) { $("chat").classList.remove("open"); return; }
    $("peer").textContent = "@" + state.active;
    renderThread(false);
  }

  function renderThread(forceBottom) {
    const box = $("thread");
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.textContent = "";
    const n = state.messages.length;
    $("cap").textContent = n ? `${Math.min(n, state.max)}/${state.max}` : "";
    if (!n) {
      box.append(el("div", { class: "empty", text: `Say hi to @${state.active}!` }));
      return;
    }
    if (n >= state.max) box.append(el("div", { class: "note", text: "Older messages are deleted automatically to keep the latest " + state.max + "." }));
    let lastDay = "";
    for (const m of state.messages) {
      const dk = dayKey(m.ts);
      if (dk !== lastDay) { box.append(el("div", { class: "day", text: fmtDay(m.ts) })); lastDay = dk; }
      const mine = m.from === state.me;
      box.append(el("div", { class: "msg " + (mine ? "me" : "them") + (m.pending ? " pending" : "") },
        el("div", { class: "bubble", text: m.text }),
        el("div", { class: "when", text: m.pending ? "sending…" : fmtTime(m.ts) })
      ));
    }
    if (forceBottom || nearBottom) box.scrollTop = box.scrollHeight;
  }

  // ── start ─────────────────────────────────────────────────────────────
  function start() {
    if (!API) return gate("Chat can't start", "The site's data address (endpoints.js) is missing.", "Back to WannaSmile");

    const approved = read(K.status) === "approved" && !!read(K.id);
    if (!approved) return gate("Sign in first", "WannaChat uses the access ticket this browser already has. Open WannaSmile4Evr, finish the ticket step, then come back here.", "Go to WannaSmile");
    if (!read(K.key)) return gate("Your ticket can't chat", "This ticket has no key, so chat can't tell it's really you. Re-import your data on WannaSmile (or request a new ticket) and try again.", "Back to WannaSmile");

    // The username is on hand straight away from the signed-in ticket; the
    // server's answer (state.me) replaces it once the first poll lands.
    state.me = read(K.user).toLowerCase();
    $("app").hidden = false;
    paintMe();
    renderFriends();
    updateCount();
    refresh(true);

    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(false); });
    window.addEventListener("focus", () => refresh(false));
    window.addEventListener("online", () => { state.fails = 0; refresh(true); });
    // Signing out (or a revoked ticket) in another tab ends this chat.
    window.addEventListener("storage", (e) => {
      if (e.key === K.status && e.newValue !== "approved") gate("Sign in first", "Your ticket isn't approved any more. Open WannaSmile to sort that out.", "Go to WannaSmile");
    });
  }

  start();
})();
