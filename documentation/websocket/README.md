# Adding a websocket to WannaChat later

**Status: not wired in.** The site's chat page (`system/pages/chat/index.html` + `system/js/chat.js`) works today by polling the Apps Script. This folder is for when you want live delivery.

## Why a Cloudflare Worker alone isn't enough
- A plain Worker is stateless: two people's sockets can land on different isolates, so one can't push to the other. A relay needs a **Durable Object** (included in `worker/`) that holds the open sockets.
- The Worker has nowhere to keep accounts, tickets, friends or messages. Those live in Google Sheets behind `data.gs`. So the Worker must call the Apps Script to check a ticket and to enforce friendships and the 60-message cap. It is a *notifier* in front of `data.gs`, not a replacement.
- Apps Script can't hold a websocket open at all, so each side covers what the other can't.
- The existing Worker at `WS_ENDPOINTS.fetch` is only an HTML-fetch proxy for "qwerty" assets. It is not a websocket relay and stays as it is.

## How the included worker works (`worker/`)
1. Browser opens `wss://<worker>/ws?ticket=…&key=…`.
2. Worker calls `data.gs ?type=whoami` with that ticket and key. A good answer gives the username; no `.ws` file is involved.
3. The socket joins that user's Durable Object "inbox".
4. Friend actions and sends go **to data.gs unchanged** (`POST type:"chat"`): the sheet remains the source of truth, 60-message trimming included.
   - Over the socket: `{"op":"act","action":"send","to":"bob","text":"hi"}` → worker POSTs to data.gs → on success pushes `{"op":"changed","rev":"…"}` to both users' inboxes.
5. On `changed`, the client does one normal `GET ?type=chat` to fetch the new state. The socket carries no message bodies, so there's no second copy of the data to go stale.

## Deploy
```
cd documentation/websocket/worker
npx wrangler deploy
```
`wrangler.toml` already holds the data URL as `DATA_URL`. Nothing else to configure.

## Changing chat.js (small)
In `system/js/chat.js`:
- Keep `post()` / `act()` as they are. They still write through data.gs.
- Keep `refresh()`. It already handles `rev` and "unchanged".
- Open the socket after the first successful `refresh()`:
  ```js
  const WS_URL = window.WS_ENDPOINTS.chatSocket;           // add to endpoints.js: "wss://<worker>.workers.dev/ws"
  function connect() {
    const ws = new WebSocket(`${WS_URL}?ticket=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.op === "changed") refresh(true); };
    ws.onclose = () => setTimeout(connect, 3000);           // keep the slow poll as a fallback
  }
  ```
- Slow the poll (`POLL_MS`) to ~60 s while the socket is open and restore it on close.

## Not done / to verify when you wire it
- Worker and `chat.js` change are untested against the live Apps Script.
- Apps Script web apps are slow (hundreds of ms per call). Sends over the socket will feel as fast as `data.gs`, not faster; the gain is instant *receiving*.
