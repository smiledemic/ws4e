
(function () {
  "use strict";

  const DATA_KEYS = [
    "ws_favorites",   // ordered favorites list (main.js initFavorites)
    // Access ticket (ticket.js), secret key included — the exported data file
    // is how a ticket gets to another browser (the tutorial's "I have a data
    // file"). (Clear My Data only drops the id/status/key, and only
    // temporarily — see CLEARABLE_KEYS.)
    "ws_ticket_id", "ws_ticket_status", "ws_ticket_key", "ws_ticket_client", "ws_ticket_requested",
    "ws_username",   // the ticket's permanent username (nickname is separate)
    // So a returning visitor restoring their data skips the tour.
    "ws_tutorial_version",
    "cloakEnabled", "cloakTitle", "cloakIcon",
    "incognitoMode",
    "panicURL",
    "accessPassword",
    "theme",
    "profileNickname", "profilePfp",
    // profile.js's real keys (the two above are older names)
    "nickname", "profilePic", "pfpPixelated", "profileBanner", "pfpAlign", "pfpFrame", "pfpWrapper", "pfpWrapperOpacity", "pfAdvancedEdit", "ws_profile_setup",
    "welcomeNeverShow",
    "ws_updates_seen",   // last "Updates & changes" release dismissed/read (updates.js)
    "searchEngine",
    "_realTitle", "_realFavicon",
    "ws_selected_widgets", "ws_active_widget", "ws_widgets_hidden",
    "ws_selected_themes",
    "ws_selected_gifpacks", "ws_active_gifpack",
    "ws_qr_cache",   // last good QRWS URL list (refer.js)
    // Paging settings (paging.js, the Settings page)
    "ws_paging_layout", "sortMode", "ws_alpha_scope", "ws_filter_scope", "ws_search_scope", "ws_flip_align", "ws_data_cache_on", "ws_bundle_tilt", "ws_bundle_hide",
    // Credits & achievements (credits.js)
    "ws_credits", "ws_credit_log", "ws_achievements", "ws_unlocks",
    "ws_rated", "ws_link_visits",   // goal-achievement progress (credits.js)
  ];

  // ── Data file (ExportData.ws) ─────────────────────────────────────────
  // SEALED: one line, "WSDATA1:" + base64url( salt | iv | AES-GCM( deflate(
  //   { "format": "wannasmile-data", "version": 1, "exported": "...", "data": { key: value } }
  // ) ) ). Unreadable as text, and AES-GCM's built-in check refuses a file
  // with even one character changed — so the credits (and everything else)
  // in it can't be edited by hand. Transfer links carry the same sealed text.
  // The passphrase has to live in this script for the site to open its own
  // files, so this stops reading and casual editing, not someone who digs
  // the key out of the code; truly tamper-proof credits would need the server.
  //
  // Older, unsealed exports (plain JSON, and old "#data=" links) still import,
  // but WITHOUT their credits/achievements: anyone could have edited those.
  // (Their ticket is still checked with the server, as always.)
  const FILE_NAME   = "ExportData.ws";
  const FILE_FORMAT = "wannasmile-data";
  const FILE_ACCEPT = ".ws,.json,text/plain,application/json";
  const TICKET_KEYS = ["ws_ticket_id", "ws_ticket_status", "ws_ticket_key", "ws_username"];
  const CREDIT_KEYS = ["ws_credits", "ws_credit_log", "ws_achievements", "ws_unlocks"];

  const SEAL_PREFIX = "WSDATA1:";
  const SEAL_PASS   = "wannasmile4evr|ExportData.ws|seal-v1";
  const SEAL_ROUNDS = 100000;

  const b64url = {
    enc(bytes) {
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    },
    dec(str) {
      const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    },
  };

  async function streamBytes(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function sealKey(salt) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(SEAL_PASS), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: SEAL_ROUNDS, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  // object -> "WSDATA1:…"
  async function seal(obj) {
    if (!window.crypto?.subtle) throw new Error("This browser can't seal data files here (needs https).");
    const packed = await streamBytes(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream("deflate"));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const ct   = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(salt), packed));
    const all  = new Uint8Array(salt.length + iv.length + ct.length);
    all.set(salt, 0); all.set(iv, 16); all.set(ct, 28);
    return SEAL_PREFIX + b64url.enc(all);
  }

  // "WSDATA1:…" -> object; throws if it isn't one, or was changed at all.
  async function unseal(text) {
    const all  = b64url.dec(text.slice(SEAL_PREFIX.length).trim());
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.subarray(16, 28) }, await sealKey(all.subarray(0, 16)), all.subarray(28));
    const json = await streamBytes(new Uint8Array(plain), new DecompressionStream("deflate"));
    return JSON.parse(new TextDecoder().decode(json));
  }

  const isDataObject = (d) => !!d && typeof d === "object" && !Array.isArray(d);

  // Unsealed (old-style) data: keep everything except the credits.
  function withoutCredits(data) {
    const out = { ...data };
    CREDIT_KEYS.forEach((k) => delete out[k]);
    return out;
  }

  function collect() {
    const out = {};
    DATA_KEYS.forEach(k => {
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = v;
    });
    return out;
  }

  // Text of a data file -> { key: value } (async). Sealed files come back
  // whole; old plain-JSON ones without their credits. Throws on anything
  // else, including a sealed file that's been changed.
  async function parseDataFile(text) {
    text = String(text || "").trim();
    if (text.startsWith(SEAL_PREFIX)) {
      const obj = await unseal(text);
      if (!obj || obj.format !== FILE_FORMAT || !isDataObject(obj.data)) throw new Error("bad format");
      return obj.data;
    }
    const obj  = JSON.parse(text);
    const data = obj && obj.format === FILE_FORMAT ? obj.data : obj;
    if (!isDataObject(data)) throw new Error("bad format");
    return withoutCredits(data);
  }

  // Writes the known keys from a parsed file. A ticket in the file is only
  // taken if the server accepts its id + key right now (so a hand-edited
  // file can't plant a junk ticket); otherwise the rest still imports.
  // Returns { count, ticket: "approved"|"pending"|"denied"|"unknown"|"" }.
  // `known`: the ticket's status if the caller already checked it. Throws if
  // the server can't be reached (so that never looks like a bad ticket).
  async function applyData(data, known) {
    let ticket = "";
    let takeTicket = false;
    if (data.ws_ticket_id && window.WS_Ticket) {
      ticket = known || await window.WS_Ticket.verify(data.ws_ticket_id, data.ws_ticket_key);
      takeTicket = ticket === "approved" || ticket === "pending" || ticket === "denied";
    }
    let count = 0;
    DATA_KEYS.forEach(k => {
      if (!(k in data) || CREDIT_KEYS.includes(k)) return;
      if (TICKET_KEYS.includes(k) && !takeTicket) return;
      localStorage.setItem(k, k === "ws_ticket_status" ? ticket : data[k]);
      count++;
    });
    // Credits come in as one unit: the balance never arrives without the
    // achievements it was earned from (which would let those be earned —
    // and paid — again). If the file has any of them, all four are replaced.
    if (CREDIT_KEYS.some(k => k in data)) {
      CREDIT_KEYS.forEach(k => {
        if (k in data) { localStorage.setItem(k, data[k]); count++; }
        else localStorage.removeItem(k);
      });
    }
    return { count, ticket };
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  async function exportData() {
    let sealed;
    try {
      sealed = await seal({ format: FILE_FORMAT, version: 1, exported: new Date().toISOString(), data: collect() });
    } catch (err) {
      console.warn("[data] export failed:", err);
      if (typeof showToast === "function") showToast("❌ Couldn't create the data file in this browser.");
      return;
    }
    const blob = new Blob([sealed], { type: "application/octet-stream" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = FILE_NAME;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (typeof showToast === "function") showToast(`✅ Data exported as ${FILE_NAME}. Keep it safe: it holds your access ticket.`);
  }

  function importData() {
    const input = document.createElement("input");
    input.type  = "file";
    input.accept = FILE_ACCEPT;
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const { count, ticket } = await applyData(await parseDataFile(await readFileText(file)));
        const note = ticket === "unknown" ? " (its ticket wasn't valid, so your current one was kept)" : "";
        if (typeof showToast === "function") showToast(`✅ Imported ${count} setting(s)${note}. Reload to apply.`);
      } catch {
        if (typeof showToast === "function") showToast("❌ Couldn't import that file: it isn't a WannaSmile data file, or it's been changed.");
      }
    });
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  }

  // The link carries the same sealed text as a data file.
  async function transferData() {
    try {
      const sealed = await seal({ format: FILE_FORMAT, version: 1, exported: new Date().toISOString(), data: collect() });
      const url    = location.origin + location.pathname + "#data=" + encodeURIComponent(sealed);

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          if (typeof showToast === "function") showToast("✅ Transfer link copied to clipboard!");
        });
      } else {

        window.prompt("Copy this transfer link:", url);
      }
    } catch {
      if (typeof showToast === "function") showToast("❌ Transfer failed.");
    }
  }

  // Same rules as a data file: the link's ticket is only taken if the server
  // accepts its id + key.
  // Sealed links come in whole; old-style (plain base64 JSON) links without
  // their credits, like old files.
  async function checkTransferLink() {
    const hash = location.hash;
    if (!hash.startsWith("#data=")) return;
    try {
      const payload = decodeURIComponent(hash.slice(6));
      let data;
      if (payload.startsWith(SEAL_PREFIX)) {
        data = await parseDataFile(payload);
      } else {
        const legacy = JSON.parse(decodeURIComponent(escape(atob(payload))));
        if (!isDataObject(legacy)) return;
        data = withoutCredits(legacy);
      }
      history.replaceState(null, "", location.pathname);
      const { count } = await applyData(data);
      if (typeof showToast === "function") {
        setTimeout(() => showToast(`✅ Transfer received — ${count} setting(s) applied. Reload to see changes.`), 500);
      }
    } catch {  }
  }

  const CLEARABLE_KEYS = [
    "ws_favorites", "favorites",   // current list + the old pre-rewrite key
    "cloakEnabled", "cloakTitle", "cloakIcon",
    "incognitoMode",
    "panicURL",
    "accessPassword",
    "selectedTheme",
    "profileNickname", "profilePfp",
    "welcomeNeverShow",
    "searchEngine",
    "dismissedUpdateVersion",
    "_realTitle", "_realFavicon",
    "ws_selected_widgets", "ws_active_widget", "ws_widgets_hidden", "ws_widget_cache",
    "ws_selected_themes", "ws_theme_cache",
    "ws_selected_gifpacks", "ws_active_gifpack",
    // Paging settings (paging.js, the Settings page)
    "ws_paging_layout", "sortMode", "ws_alpha_scope", "ws_filter_scope", "ws_search_scope", "ws_flip_align", "ws_data_cache_on", "ws_bundle_tilt", "ws_bundle_hide",
    // Credits & achievements (ws_credits, ws_credit_log, ws_achievements,
    // ws_unlocks, ws_rated, ws_link_visits) are KEPT, like the ticket: the
    // "R u Sure?" modal promises it, and it's safe because credits.js pays
    // each achievement once by id (award() answers false if already earned),
    // so the tutorial restarting below can't be farmed for credits.
    "ws_cache_assets", "ws_cache_quotes", "ws_cache_searchquotes",   // data cache copies (datacache.js)
    "ws_qr_cache",   // last good QRWS URL list (refer.js)
    // Daily picks (daily.js): "Not today" snooze, flipped cards, last mode.
    // Clearing these makes the pop-up show again after the reload below.
    "ws_daily_snooze", "ws_daily_picks", "ws_daily_mode", "ws_daily_rerolls",
    // profile.js's real keys (profileNickname/profilePfp above are older
    // names), plus the tutorial flag so a cleared visitor gets the tour again.
    "nickname", "profilePic", "pfpPixelated", "profileBanner", "pfpAlign", "pfpFrame", "pfpWrapper", "pfpWrapperOpacity", "pfAdvancedEdit", "ws_profile_setup",
    "ws_tutorial_version",
    // Early access (main.js): which tester assets were already announced,
    // and the list kept for the credits page.
    "ws_tester_seen", "ws_tester_assets",
    // The access ticket (id, status, key, username) is NOT cleared: it's the
    // user's one ticket, so after a clear they skip the ticket screens and
    // go straight to setting up their profile (the tour starts over).
  ];

  async function clearData() {
    // Close the ☰ menu first so the modal isn't fighting it for focus.
    const dash = document.getElementById("dashboardMenu");
    if (dash && dash.style.display === "block") document.getElementById("dashboardBtn")?.click();

    const confirmed = window.WSRuSure
      ? await window.WSRuSure.ask({
          title:   "R u Sure?",
          body:    "clearing your data removes your favorites, saved profile, banner, and etc!",
          keep:    "you keep: ur existing ticket, username & credits..",
          cancel:  "no take me back!",
          confirm: "yes clear data",
          danger:  true,
        })
      : window.confirm("Clear all your saved data?\n\nYou keep your ticket, username and credits.\n\nThis cannot be undone.");
    if (!confirmed) return;

    CLEARABLE_KEYS.forEach(k => localStorage.removeItem(k));

    try {
      const htmlTitle = document.querySelector("title");
      if (htmlTitle) document.title = htmlTitle.textContent || document.title;

      const favLink = document.querySelector("link[rel~='icon']");
      if (favLink) favLink.href = favLink.dataset.realHref || "/favicon.ico";

      const cloakImg = document.querySelector("#cloak-btn img");
      if (cloakImg) cloakImg.src = "assets/images/cloak-btn/visable.png";

      document.documentElement.setAttribute("theme", "redux");
    } catch {}

    if (typeof showToast === "function") showToast("🗑️ Data cleared. Reloading…");
    setTimeout(() => location.reload(), 1200);
  }

  document.addEventListener("DOMContentLoaded", () => {
    checkTransferLink();

    const exportBtn = document.getElementById("exportData");
    const importBtn = document.getElementById("importData");
    const transBtn  = document.getElementById("transData");
    const clearBtn  = document.getElementById("clearData");

    exportBtn?.addEventListener("click", (e) => { e.preventDefault(); exportData(); });
    importBtn?.addEventListener("click", (e) => { e.preventDefault(); importData(); });
    transBtn?.addEventListener("click",  (e) => { e.preventDefault(); transferData(); });
    clearBtn?.addEventListener("click",  (e) => { e.preventDefault(); clearData(); });
  });

  window.wsData = {
    export: exportData, import: importData, transfer: transferData, clear: clearData,
    // For the tutorial's "I have a data file" card.
    readFileText, parseDataFile, applyData, fileAccept: FILE_ACCEPT, fileName: FILE_NAME,
  };
})();