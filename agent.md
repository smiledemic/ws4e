# agent.md — WannaSmile (wannasmile4evr.github.io)

Guide for AI coding agents (Copilot in VS Code). Read this before editing. Keep changes small, match the
existing style, and don't add build tooling: the site is plain HTML/CSS/vanilla JS served by GitHub Pages.

## What this is

A browsable library of web games/assets ("WannaSmile"). Content, themes, tickets and moderation lists live in
Google Sheets and are served by three Google Apps Script projects. Media lives in a separate GitHub repo.
There are no accounts: everything a visitor sets up is saved in `localStorage` (one access ticket per browser).

## Layout (after the restructure)

```
index.html                     the main app (root page)
system/                        ALL code — never put media here
  js/  css/  json/             one file per feature (see "Modules")
  pages/<page-name>/index.html discord, discovery, dmca, main (copy of the index), settings, store,
                               credits-n-achievements
  tools/                       dev tools (debug, asset-images, stickers, image-convert, …)
assets/
  media/                       site-local images/gifs/cursors/favicons only
.github/workflows/             Pages deploy (Jekyll, source ./)
.documentation/                git-ignored: Apps Script sources (data.gs, cust.gs, mod.gs) and notes
```

Everything that used to be under `assets/system/` is now `system/`. Never write `assets/system/…` again.

### Path rules (important — pages moved one level deeper)

| File lives in | Site root is | Media is |
|---|---|---|
| `index.html` | `./` | `assets/media/…` |
| `system/pages/<name>/index.html` | `../../../` | `../../../assets/media/…` |
| `system/tools/*.html` | `../../` | `../../assets/media/…` |
| `system/js/*.js`, `system/css/*.css` | `../../` | `../../assets/media/…` |

- Scripts/styles referenced from a page: `../../js/x.js` (from `system/pages/<name>/`), `system/js/x.js` (from root).
- Link between pages: `../<other-page>/index.html`. Back to the app: `../../../index.html`.
- In JS, build URLs from the script's own location instead of hard-coding (existing pattern):
  `new URL("../../", document.currentScript?.src || location.href)` = site root from `system/js/`.
- KNOWN ISSUE: several JS files still use root-relative strings such as `"assets/media/…"` (boom.js, panic.js,
  settings.js, data.js, quotes.js, main.js). They only work on `index.html`; on `system/pages/main/index.html`
  (a stale copy of the index) those images 404. Fix by resolving them against the site root if that page matters.

## Backends (Apps Script) — URLs live in `system/js/endpoints.js` (`window.WS_ENDPOINTS`)

| Project | File | Serves |
|---|---|---|
| DATA | data.gs | `AssetBuilderWS` (assets, discovery + ratings), `DevBuildWS`, `QuoteSystemWS`, `SystemDataSyncWS`, `TicketApprovalWS`, `RatingLogWS`, **`ContribWS`** |
| CUST | cust.gs | `ThemifyWS`, `WidgetBaseWS`, `BannerWS`, `GifPacksWS`, **`FramesWS`**, **`WrapperWS`** |
| MOD | mod.gs | `TicketFilterWS` (word filter), `UsernameListed` — open, no ticket |

- Every DATA/CUST feed needs `&ticket=<id>&key=<key>` from an approved ticket. Unknown and wrong-key tickets look
  identical. `?type=build` reports the deployed build (`WS-DATA-03`, `WS-CUST-06`, `WS-MOD-01`) — bump on every deploy.
- After deploying a script, paste its new `/exec` URL into `endpoints.js`. Feeds are cached 300 s server-side;
  `onEdit`/`onSheetChange` clear them (`installChangeTrigger()` once).
- Client fetches go through `ticketReady()` then `fetch(bustCache(url), {cache:"no-store"})`.

### CUST feeds added for frames / wrappers

- `?type=frames` → rows of `FramesWS`: `id | name | type | ext | animated | scale | pixelated | blend`
- `?type=wrappers` → rows of `WrapperWS`: `id | name | type | ext | animated | pixelated`
- `type = soon` hides a row. `ext` blank = `png`. `scale` blank = 1.2 (frame size ÷ picture size).
- `blend` (optional) = CSS `mix-blend-mode` (`screen`, `multiply`, `lighten`, `darken`, `overlay`…) for frames that are
  opaque `.jpg`s: `screen` makes a black middle vanish, `multiply` a white one. A plain `.jpg` with no blend covers the picture.
- Opacity is deliberately NOT in the sheet: it is a per-user setting (see below).

## Media repo: github.com/wannasmile4evr/mediabaseWS (served from raw.githubusercontent.com)

Current layout (after the Copilot pass; `modifiedMediabasews.txt` was the plan, the repo is the truth). Conventions:

```
banners/<id>/splash.<ext>          one folder per banner, no thumbs/ any more (BannerWS `thumb` column is unused)
gif-packs/<id>/                    loading|loaded|searching|held|drop|crash|ded .gif
stickers/<pack>/                   sticker files
themes/<id>/mainBg.<ext>           (+ headerBg/quoteBg/footerBg for redux); newer themes use splash.<ext>
                                   (balila, checkmate, death-by-sunrise, enitity-forest, malousios, sacrifice),
                                   the ThemifyWS row holds the real path, so both work
profile/…                          halloween/ (skele.jpg, pumpkinPalLeft/Right.gif), autumn/, profilepicture.jpg
frames/<id>/splash.<ext>           profile picture frames (drawn on top of the picture)
wrappers/<id>/splash.<ext>         profile card backgrounds (PLURAL folder name)
.tsv/                              copies of the sheets (bannerws, frames, gifpacks, themify, wrapper) for reference
```

- `window.toMediabase(url)` (endpoints.js) rewrites old site paths / old repo names (`wannabase`) to mediabaseWS,
  accepts plain repo paths (`banners/buni/splash.jpg`, with or without a `site:` prefix) and
  maps `themes/<id>/system-media/` → `themes/<id>/`, `gif-states/` → `gif-packs/<id>/`. Wrap media URLs from
  sheets or caches with it.
- `<id>` folder = the `id` column of the sheet row, lowercase, no spaces (raw URLs are case-sensitive).

## Modules (system/js) — load order matters

`endpoints.js` first (defines `WS_ENDPOINTS`, `toMediabase`), then `utils.js`, `ticket.js` (gate), `themify.js`,
`frames.js`, `wrappers.js`, `cursors.js`, … `rusure.js`, `data.js`, … `main.js`. Pages load only what they need.

| File | Job |
|---|---|
| main.js | fetch assets, prepare rows (`prepareAssets`), bundles (`_groupBundles`), cards, search, paging, favorites |
| paging.js | `WS_Paging` (layout/sort/scope settings) and `WS_BundleSettings` (deck tilt, hide versions) |
| profile.js | profile modal: picture, banner, nickname, frames, wrapper, gear menu, crop |
| frames.js / wrappers.js | `WSFrames` / `WSWrappers`: load sheet feed, cache list, build URLs, paint overlays |
| themify.js | themes + gif packs from CUST, applies CSS variables |
| daily.js | Daily picks pop-up (6 picks/day, cards or wheel) |
| shortcuts.js | Keyboard shortcuts panel |
| tutorial.js | first-run tour (bump `TUTORIAL_VERSION` to show it again) |
| rusure.js | `WSRuSure.ask({title, body, keep, cancel, confirm, danger})` → Promise<boolean> confirm modal |
| data.js | export / import / transfer / clear data (`CLEARABLE_KEYS`) |
| credits.js | credits + achievements (`award(id)` pays once) |
| ticket.js | access-ticket gate; `ticketReady()` |
| store page | widgets, themes, gif packs, frames, wrappers, cursors |

Header icon buttons: `#openDailyPicks` and `#openShortCuts` are `<button class="hdr-icon-btn">` in `.pages-anchor`
(icons `assets/media/images/icons/daily.png`, `shortcuts.png`, 32 px pixel art, `image-rendering: pixelated`).
They are NOT in the ☰ dashboard menu any more.

## localStorage keys you will touch

Profile: `nickname`, `profilePic`, `pfpPixelated`, `profileBanner`, `pfpAlign`, `pfpFrame` (URL or data URL),
`pfpWrapper` (URL), **`pfpWrapperOpacity`** (0–100 string, absent = 100; a slider in the profile modal's gear menu).
Bundles: `ws_bundle_tilt`, **`ws_bundle_hide`** (`"1"` = keep version assets hidden). Caches: `ws_frame_cache`,
`ws_wrapper_cache`, `ws_qr_cache`. Ticket: `ws_ticket_id|status|key`, `ws_username`. Credits: `ws_credits`, `ws_credit_log`,
`ws_achievements`, `ws_unlocks`, `ws_rated`, `ws_link_visits`.

Any new persistent key must be added to BOTH lists in `data.js` (the exportable list near the top and
`CLEARABLE_KEYS`), unless it should survive "Clear My Data".

**Clear My Data keeps** the ticket, username and credits (credits, log, achievements, unlocks, rated, visits).
It asks first with the "R u Sure?" modal (`WSRuSure`), never `window.confirm`.

## Features implemented recently (behaviour to preserve)

- **Frames**: overlay above the picture (`z-index` above it), `--pf-frame-scale`, header avatar wrapped in `.pfp-wrap`.
  Picker = Frames tab in the profile library + Store → Frames (Equip toggles on/off).
- **Wrapper**: `#profileWrapper.pf-wrapper` absolutely fills the profile card behind everything; image scaled to
  the card's height (`background-size: auto 100%`), centred, extra width clipped. Card is `overflow: visible`
  (the gear menu is taller than the card) so radius is applied to the banner and wrapper layer instead.
- **Keep version assets hidden** (Settings → Bundles): status `ok|merge` rows are dropped in `prepareAssets`
  so they are never built; toggling rebuilds from the last fetched rows (`_rawAssets`) without refetching.
  Off (default) = versions show as a deck behind the parent card.
- **R u Sure?** modal: `system/js/rusure.js` + `system/css/rusure.css`, styled like the profile modal; Esc/backdrop =
  no; swallows keys so Esc can't trigger the panic key.
- **Refer a friend**: `system/js/refer.js` + `system/css/refer.css`; fetches QRWS URLs on open, builds QR codes in
  the browser, chooses one at random on each open, and supports browsing/copying the listed links.

## Debug panel access (ContribWS)

Typing `debugplz!` opens `system/tools/debug.html` for contributors only (`system/js/devtools.js`, `WS_Dev`).
Contributors are rows of the DATA sheet **ContribWS** (`TicketID | Username | Note`); there is no list file on the
site any more (`system/tools/list.json` was deleted). The browser calls `data.gs ?type=contrib` with its own ticket +
key and gets only `{ listed: true|false }`; the server matches the listed Username against the Name the ticket was
created with (case-insensitive, leading `@` ignored), so the list is never sent to anyone and a copied ticket id is
useless. A yes is remembered 30 min (`ws_dev_ok`) and re-checked in the background every 2 min (`ws:dev-revoked`).
Reason codes shown by debug.html: `no-ticket`, `no-username`, `not-listed`, `server-status`, `server-unreachable`.
Tab names in data.gs are matched case-insensitively (`ContribWS` or `contribWS`).

## Conventions

- Vanilla JS, `"use strict"`, IIFEs, no frameworks, no bundler. Comments explain *why* and document keys/feeds at
  the top of each file.
- Anything from a sheet, a user or storage goes into the DOM with `textContent`/DOM APIs, not `innerHTML`
  (there is a `sanitizer.js` for the few places HTML is needed). Cells that look like formulas are stored as text.
- Don't add `alert/confirm`; use `showToast(msg)` and `WSRuSure`.
- Respect `prefers-reduced-motion`; keep focus management and `aria-*` on modals.
- Never commit `*.ws` export files (they contain a ticket + key), `.documentation/`, `.vscode/`, `launcher/`.
- Don't commit real ticket ids, keys or the `SECRET_TOKEN`.

## How to add things

- **Frame**: put `frames/<id>/splash.<ext>` in mediabaseWS → add a row to `FramesWS` (`id`, `name`, optional
  `ext`, `scale`, `animated`, `pixelated`). Art: transparent middle, picture area ≈ centre 83 % of a square canvas.
- **Wrapper**: `wrappers/<id>/splash.<ext>` → row in `WrapperWS`. Wide images (≈2.2:1 or wider) fill the card; a
  narrower image leaves empty side strips because only the height is fitted.
- **Theme / banner / gif pack**: same idea with `ThemifyWS` / `BannerWS` / `GifPacksWS`.
- **New feed in cust.gs**: add the sheet to `CU_SHEET`, `CU_FEEDS_BY_SHEET`, `CU_ALL_FEEDS`, a `case` in `doGet`,
  bump `CU_BUILD`, redeploy, paste the new `/exec` URL into `endpoints.js`.

## Testing (no test suite; do this before finishing)

1. `python -m http.server 8000` in the repo root, open `http://localhost:8000/`.
2. Crawl every page and confirm no 404s for local files: index, each `system/pages/*/index.html`, `system/tools/*.html`.
3. Static check: every relative `src`/`href` in every `.html` resolves to an existing file.
4. `node --check` each JS file you touched.
5. For UI work use a headless browser (Playwright): route the Apps Script URLs to canned JSON, seed
   `ws_ticket_status=approved`, `ws_ticket_id`, `ws_ticket_key`, `ws_username`,
   `ws_tutorial_version=4evr-1`, `ws_profile_setup=1` so the tutorial/gate don't cover the page
   (the tutorial's key guard swallows Esc while it's active). Close the auto Daily-picks pop-up (`.wsd-close`).

## Roadmap not built yet (from roadmap.ws)

- `ReportsWS` sheet in data.gs (`timestamp, reason, ticket-id, resolved?`) and the hazard-trench icon POSTing reports.
- Discovery: treat `ok|merge` rows as versions of their parent (rated as one, duplicates not shown).
- Achievements: hidden achievements shown as `?`, a "(...)" button opening `system/pages/achievements/index.html`.
- Early access: `EarlyAccessWS` (AssetBuilderWS columns + `CreditAmount`, `EarlyRating`, `Wormed?`) and
  `EarlyRatingsWS` (`Timestamp, TicketID, Link, Title, Rating, Feedback`) in a new `earlyworm.gs`; unpurchased
  assets greyed out with a price, purchase via a "R u Sure?" modal; `Wormed?` = yes/wormed/y/w hides the asset and
  raises a sitewide notification, later shown in history.
- Later: credit minigames ("credit clicker", "wannaRun"); credits for themes/gif packs/banners.
