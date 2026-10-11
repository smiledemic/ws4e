# WannaChat API (data.gs, build WS-DATA-06)

No websocket, no `.ws` file. The browser's own ticket is the login: `chat.js` reads `ws_ticket_id`, `ws_ticket_key` and `ws_ticket_status` from localStorage. The username is the ticket's **Name** column, looked up server-side. The browser can't claim a name. A ticket without a key (from before keys existed) can browse the site but can't chat.

Base URL: `WS_ENDPOINTS.data`.

## Read: `GET ?type=chat&ticket=…&key=…[&with=<friend>][&rev=<last rev>]`
```json
{ "ok": true, "me": "alice", "rev": "k3j9…", "max": 60,
  "friends": [ { "name": "bob", "status": "friend|incoming|outgoing", "last": { "from": "bob", "text": "hey", "ts": 1760000000000 } } ],
  "with": "bob", "messages": [ { "from": "bob", "text": "hey", "ts": 1760000000000 } ] }
```
Send the `rev` you got last time. If nothing changed the answer is `{ "ok": true, "unchanged": true, "rev": "…", "me": "…" }`, served from cache without reading a sheet. That is what makes polling cheap.

## Act: `POST` (JSON body, send as `text/plain` to avoid a CORS preflight)
`{ "type": "chat", "action": …, "ticket": …, "key": … }` plus:

| action | fields | effect |
|---|---|---|
| `request` | `to` | friend request (if they already asked you, it's accepted) |
| `accept` / `decline` | `from` | answer an incoming request |
| `cancel` | `to` | withdraw your outgoing request |
| `remove` | `name` | unfriend and delete the chat |
| `send` | `to`, `text` | message an accepted friend (max 500 chars, 8 per 10 s) |

Errors: `{ "ok": false, "code": "ticket|bad_name|self|no_user|full|too_many|no_request|not_friends|empty|slow|bad_action", "error": "…" }`.

## Retention
60 messages per friendship. Each new message deletes the oldest beyond 60 (`_chatTrimPair`); `chatCleanup()` re-checks daily.

## Identity helper: `GET ?type=whoami&ticket=…&key=…`
`{ "ok": true, "ticket": "…", "name": "alice" }` — only answers for an approved ticket with the matching key. The websocket worker uses this to log a socket in.
