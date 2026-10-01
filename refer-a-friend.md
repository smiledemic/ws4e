# refer-a-friend.md — "Refer a friend" QR modal (task for the agent)

Read `agent.md` first (layout, path rules, backends, conventions, testing). This file is the spec for ONE feature.
Do not change anything outside the files listed here.

## What the owner asked for (roadmap.ws, verbatim intent)

> in the index, dashboard hamburger icon/dashboard should have 2 new pages;
> "refer to a friend" which opens a modal with a QR code, which reads from data.gs NEW sheet of "QRWS" of which
> structure; `valid-qr-url` then one URL per row. Reads the valid urls, and creates QR codes from those urls, while
> also displaying at the bottom, a copyable version of that url!
> PLUS extra protection on "clear my data" as a new RuSure? modal.

- The second item ("R u Sure?" on Clear My Data) is **already done** (`system/js/rusure.js`). Only "Refer a friend" remains.
- The sheet header in the roadmap is spelled `vaid-qr-url`; treat it as `valid-qr-url`. The code must not depend on the
  header text: always read **column A**, skip row 1.

## User-visible behaviour

1. `index.html` → ☰ menu (`#dashboardMenu`) gets a new entry **Refer a friend** between "Credits & achievements" and
   "Clear My Data": `<a href="#" id="openRefer" title="Share WannaSmile with a friend">Refer a friend</a>`.
2. Clicking it closes the ☰ menu (same as `clearData()` does in `data.js`) and opens a modal.
3. The modal shows, for the current URL from the sheet:
   - a **QR code** (scannable, see "QR rendering"),
   - below it the **URL as text in a read-only input** with a **Copy** button (toast/inline "Copied!").
4. Build a QR code for every valid URL returned by the sheet. Show a random one each time the modal opens. If the sheet
  returns several URLs, show one at a time with ◀ ▶ buttons and a counter (wrap around). One URL = no arrows.
5. Shift-clicking the displayed QR copies its URL. The read-only URL input and Copy button remain available.
6. States: *loading* ("Making your QR code…"), *empty* ("No link to share right now."), *error* ("Couldn't load the link.
   Try again." + Retry button). Fall back to the last good list (`ws_qr_cache`) when the fetch fails.
7. Close with ✕, Esc, or a backdrop click. Focus returns to the menu link's opener (the ☰ button).

Never put the visitor's ticket, key, username or nickname into any shared URL. The URLs are exactly what is in the sheet.

## Backend — data.gs (DATA project) — bump `WS_BUILD` (currently `WS-DATA-03`, which added ContribWS) to `WS-DATA-04`

The owner pasted the current `data.gs`; edit that file (it lives in `.documentation/` / the Apps Script editor, not in the site repo).

1. `const SHEET = { …, qr: "QRWS" }`.
2. `FEEDS_BY_SHEET[SHEET.qr] = ["qr"]` and add `"qr"` to `ALL_FEEDS` (so `onEdit` / `clearCache()` invalidate it).
3. `doGet`: `case "qr": return _qrGet(fresh);` — it sits **after** the ticket check like `quotes`, so the feed needs an
   approved `&ticket=&key=` (ticket.js appends those automatically to script.google.com URLs).
4. `_qrGet(fresh)` — model it on `_quotesGet` (same `_serve(feed, fresh, build, onError)` cache helper, column A):
   - read column A, row 1 = header; skip blank rows and rows starting with `#`;
   - keep only URLs that match `/^https?:\/\/[^\s]+$/i`, max 500 chars, strip a leading `'` (Sheets text escape),
     de-duplicate, cap at 12 entries;
   - return `{ "<A1 header>": ["https://…", …] }` (same shape as quotes) or `{ error: "…" }` via `_errMsg`.
5. Update the header comment block of data.gs: add `QRWS  ?type=qr (col A)`, bump `WS_BUILD`, and fix the stale path
   `assets/system/js/endpoints.js` → `system/js/endpoints.js`.
6. `MOVED_TO_CUST` is unchanged. Redeploy as a new version, then ask the owner for the new `/exec` URL and put it in
   `system/js/endpoints.js` (`data:`). Check with `?type=build` → `{"build":"WS-DATA-04"}`.

Sheet template (tab **QRWS**, tab-separated, `QRWS.tsv` is provided next to this file):

```
valid-qr-url
https://wannasmile4evr.github.io/
```

## Frontend files to add / change

| File | Change |
|---|---|
| `index.html` | menu entry above; `<link rel="stylesheet" href="system/css/refer.css" />`; `<script src="system/js/refer.js"></script>` next to `rusure.js` (before `data.js` is fine) |
| `system/js/refer.js` | NEW — `window.WSRefer = { open(), close() }`, binds `#openRefer` |
| `system/css/refer.css` | NEW — modal styles |
| `system/js/vendor/qrcode.js` | NEW — QR generator (see below) |
| `system/js/data.js` | if you cache the list, add `"ws_qr_cache"` to BOTH key lists (export list near the top and `CLEARABLE_KEYS`) |
| `agent.md` | move "Refer a friend" from "Roadmap not built yet" to the implemented list; add the `ws_qr_cache` key |

Do not edit `system/pages/main/index.html` (stale copy of the index).

### Fetching

```js
await window.WS_Ticket?.ready;                       // ticket gate (ticket.js)
const res  = await fetch(bustCache(`${window.WS_ENDPOINTS.data}?type=qr`), { cache: "no-store" });
const json = await res.json();                        // { "<header>": [urls] } or { error, ticket? }
const urls = Object.values(json).find(Array.isArray) || [];
```

- Re-validate every URL client-side (`new URL(u)`, protocol `http:`/`https:` only) before rendering; drop the rest.
- If `json.error` or the request fails: use the cache if it has entries, otherwise show the error state.
- Write the good list to `localStorage["ws_qr_cache"]` (JSON array) inside try/catch.
- Fetch when the modal opens (not at page load) so a visitor without a ticket yet doesn't trigger a 'ticket required' error.

### QR rendering

- Use a small MIT-licensed generator, **vendored**, not fetched at runtime: `qrcode-generator` by Kazuhiko Arase
  (`qrcode.js`, API: `const qr = qrcode(0, "M"); qr.addData(url); qr.make(); qr.getModuleCount(); qr.isDark(r, c)`).
  Put it in `system/js/vendor/qrcode.js` with its license header. (`cdnjs.cloudflare.com` is already used for
  cropper.js if you'd rather load it from there, but vendoring keeps the modal working offline.)
- Type number `0` (auto), error correction `M`.
- Draw an **inline `<svg>`** (`viewBox` = modules + 2×4 quiet-zone, `shape-rendering="crispEdges"`, one `<path>` of
  `M x y h1 v1 h-1 z` cells, or run-length rects). Do not use a third-party image API: the URL must not leave the browser.
- Always **black modules on a white background with the 4-module quiet zone**, whatever the site theme is (themes are
  dark; a themed QR won't scan). Give the white card rounded corners and a border that uses `var(--accent-color)`.
- Size: `width: min(72vw, 260px)`; SVG gets `role="img"` and `aria-label="QR code for <url>"`.
- Very long URLs can overflow the QR capacity: catch the exception from `addData/make` and show "That link is too long
  for a QR code." plus the copyable URL anyway.

### Modal — copy the style and behaviour of `rusure.js` / `rusure.css`

- Overlay `position: fixed; inset: 0; z-index: 10000`, same blurred polka-dot backdrop, tilted panel with
  `border: 3px solid var(--accent-color)` and the offset `box-shadow`, sticker-style `<h2>` **"Refer a friend"**,
  one line of body text ("Scan this with a friend's phone, or copy the link."), monospace, `prefers-reduced-motion` respected.
- Build everything with DOM APIs / `textContent`. No `innerHTML` with sheet data.
- Accessibility: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus moves into the modal (first control),
  Tab is trapped, Esc closes and is swallowed with `stopImmediatePropagation()` so it can't reach the panic key,
  `aria-live="polite"` on the copy status, the ◀ ▶ buttons have `aria-label`s.
- Copy button: `navigator.clipboard.writeText(url)`; fallback `input.select(); document.execCommand("copy")`.
  Also select the text when the input is focused/clicked. Show "Copied!" for ~1.5 s (use `showToast` if present).
- Only one instance at a time; opening it twice must not stack overlays.
- Tutorial: no change needed (don't bump `TUTORIAL_VERSION`). Keyboard shortcuts panel: no change.

## Acceptance checklist

- [ ] `?type=qr` answers only with an approved ticket; wrong/missing ticket behaves like the other feeds.
- [ ] Editing the QRWS sheet updates the modal within the feed cache time (onEdit clears the cache).
- [ ] A QR for `https://wannasmile4evr.github.io/` scans correctly with a phone camera (test a real scan).
- [ ] Copy button puts exactly the shown URL on the clipboard; works over `http://localhost` and on GitHub Pages (https).
- [ ] 0 URLs → empty state; fetch failure → cache or error+Retry; 3 URLs → arrows + counter wrap around.
- [ ] Esc / ✕ / backdrop close it; focus returns to the ☰ button; Esc does not trigger the panic key.
- [ ] Keyboard-only: open from the menu, reach Copy and ◀ ▶, close.
- [ ] No console errors; every relative path resolves (run the crawl from `agent.md`); `node --check` on new JS.
- [ ] "Clear My Data" still works and still asks "R u Sure?" first; the ☰ menu looks unchanged except the new entry.

## Test hints (headless)

Route the Apps Script URL to canned JSON (`{"valid-qr-url":["https://example.com/a","https://example.com/b"]}`), seed
`ws_ticket_status=approved`, `ws_ticket_id`, `ws_ticket_key`, `ws_username`, `ws_tutorial_version=4evr-1`,
`ws_profile_setup=1`, `ws_daily_snooze=9999999999999`, close the Daily-picks pop-up (`.wsd-close`), click `#dashboardBtn`
via `evaluate(...click())` (icon fonts are blocked offline so the button can report zero height), then `#openRefer`.
Decode the rendered SVG back with a QR reader (e.g. `jsqr` / `zbarimg` on a screenshot) to prove it scans.
