// WannaChat websocket notifier (NOT wired into the site; see ../README.md).
// data.gs stays the source of truth. This worker only
//   1. logs a socket in with the browser's own ticket + key (?type=whoami),
//   2. forwards chat actions to data.gs unchanged,
//   3. tells both people "something changed" so their page refetches.

const NAME_RE = /^[a-z0-9][a-z0-9_.\-]{2,19}$/;

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "content-type",
});

async function whoami(env, ticket, key) {
  const u = new URL(env.DATA_URL);
  u.search = new URLSearchParams({ type: "whoami", ticket, key }).toString();
  const r = await fetch(u, { redirect: "follow" });
  const j = await r.json().catch(() => null);
  return j && j.ok && NAME_RE.test(j.name || "") ? j.name : null;
}

async function dataPost(env, body) {
  const r = await fetch(env.DATA_URL, {
    method: "POST",
    redirect: "follow",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({ ok: false, error: "Bad answer from data." }));
}

const inbox = (env, name) => env.INBOX.get(env.INBOX.idFromName(name));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") return new Response("WannaChat websocket. Connect to /ws.", { status: 200, headers: cors() });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket.", { status: 426 });

    const ticket = url.searchParams.get("ticket") || "";
    const key = url.searchParams.get("key") || "";
    const name = ticket && key ? await whoami(env, ticket, key) : null;
    if (!name) return new Response("Not logged in.", { status: 401 });

    // The user's inbox keeps all of their open sockets (several tabs are fine).
    const target = new Request("https://inbox/connect?name=" + encodeURIComponent(name), request);
    target.headers.set("x-ticket", ticket);
    target.headers.set("x-key", key);
    return inbox(env, name).fetch(target);
  },
};

export class Inbox {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/notify") {                    // from another inbox: push to my sockets
      const msg = await request.text();
      for (const ws of this.state.getWebSockets()) { try { ws.send(msg); } catch (_) {} }
      return new Response("ok");
    }

    const name = url.searchParams.get("name");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ name, ticket: request.headers.get("x-ticket"), key: request.headers.get("x-key") });
    server.send(JSON.stringify({ op: "hello", me: name }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const who = ws.deserializeAttachment() || {};
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    if (!m || m.op !== "act" || typeof m.action !== "string") return;

    // Only the fields data.gs knows about; identity always comes from the login above.
    const body = { type: "chat", action: m.action, ticket: who.ticket, key: who.key };
    for (const k of ["to", "from", "name", "text"]) if (typeof m[k] === "string") body[k] = m[k].slice(0, 600);

    const res = await dataPost(this.env, body);
    ws.send(JSON.stringify({ op: "result", id: m.id || null, ok: !!res.ok, error: res.error || null, code: res.code || null, rev: res.rev || null }));
    if (!res.ok) return;

    const note = JSON.stringify({ op: "changed", rev: res.rev || null });
    const others = new Set([who.name]);
    for (const k of ["to", "from", "name"]) {
      const n = String(body[k] || "").trim().replace(/^@/, "").toLowerCase();
      if (NAME_RE.test(n)) others.add(n);
    }
    await Promise.all([...others].map((n) =>
      inbox(this.env, n).fetch("https://inbox/notify", { method: "POST", body: note }).catch(() => {})));
  }

  webSocketClose(ws) { try { ws.close(); } catch (_) {} }
  webSocketError() {}
}
