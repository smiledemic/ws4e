"use strict";

// ── Gif pack editor ────────────────────────────────────────────────────
// A pop-up on the store page for making your own gif pack. Drop (or pick) a
// .gif for each of the five states and save: the pack is stored in this
// browser only (themify.js, ws_custom_gifpacks) and then behaves like any
// other pack: Activate it, add it to the [ / ] cycle.
//
//   loading    while the site loads
//   loaded     pops in when loading finishes
//   ded        what's left on screen after a crash
//   crash      plays when the site crashes
//   searching  an empty search ("search" in the editor)
//
// Any state you skip uses the default pack's gif. Needs window.GifPacks
// (themify.js). Same look as the "R u Sure?" modal (rusure.css).
//
//   WSGifEditor.open({ id })  -> Promise<string | null>
//     id: edit that pack; leave it out to make a new one.
//     Resolves with the saved pack's id, "deleted:<id>" if the pack was
//     deleted from inside the editor, or null if closed without saving.
//
// All user text goes in with textContent, never HTML. The gifs are read as
// data: URLs and must really be GIFs (checked by their first bytes).
(() => {
  const STATES = [
    { key: "loading",   label: "Loading", hint: "plays while the site loads" },
    { key: "loaded",    label: "Loaded",  hint: "pops in once it's done" },
    { key: "ded",       label: "Ded",     hint: "what's left after a crash" },
    { key: "crash",     label: "Crash",   hint: "plays when the site crashes" },
    { key: "searching", label: "Search",  hint: "shows on an empty search" },
  ];
  const MAX_BYTES = 400 * 1024;   // per gif: they all live in localStorage
  const NAME_MAX  = 24;

  let pending = null;

  const CSS = `
    .ge-overlay { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center;
      padding: 18px 12px; font-family: monospace; font-size: 14px; color: var(--url-color, #fff);
      background: radial-gradient(circle, rgba(255,255,255,0.12) 1.5px, transparent 2px) 0 0 / 22px 22px, rgba(0,0,0,0.45);
      backdrop-filter: blur(9px) saturate(1.3); -webkit-backdrop-filter: blur(9px) saturate(1.3);
      opacity: 0; transition: opacity 0.18s ease; }
    .ge-overlay.is-open { opacity: 1; }
    .ge-panel { width: min(94vw, 740px); max-height: 94vh; overflow-y: auto; padding: clamp(16px, 3vh, 26px);
      border-radius: 22px 18px 24px 16px; border: 3px solid var(--accent-color, #f44);
      background: var(--aside-bg, rgba(0,0,0,0.94)); box-shadow: 8px 8px 0 var(--accent-color, #f44);
      transform: rotate(-0.3deg); outline: none; }
    .ge-overlay.is-open .ge-panel { animation: ge-pop 0.45s cubic-bezier(.3,1.6,.5,1); }
    @keyframes ge-pop { from { transform: rotate(-4deg) scale(0.88); opacity: 0; } to { transform: rotate(-0.3deg) scale(1); opacity: 1; } }
    .ge-title { display: inline-block; margin: 0 0 12px; padding: 3px 14px 5px; border-radius: 10px 14px 9px 13px;
      background: rgba(0,0,0,0.55); font-size: clamp(20px, 3vh, 28px); line-height: 1.15; transform: rotate(-2deg);
      text-shadow: 3px 3px 0 var(--accent-color, #f44); box-shadow: 3px 3px 0 rgba(0,0,0,0.45); }
    .ge-tip { margin: 0 0 14px; line-height: 1.5; opacity: 0.85; font-size: 0.85em; }
    .ge-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .ge-field > span { font-weight: bold; font-size: 0.85em; }
    .ge-input { padding: 9px 12px; border-radius: 10px; border: 2px solid rgba(255,255,255,0.3); background: rgba(0,0,0,0.5);
      color: inherit; font: inherit; }
    .ge-input:focus { outline: none; border-color: var(--accent-color, #f44); }
    .ge-slots { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 12px; margin-bottom: 14px; }
    .ge-slot { position: relative; display: flex; flex-direction: column; gap: 5px; padding: 10px; border-radius: 14px 11px 15px 12px;
      border: 2px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); }
    .ge-slot.has-gif { border-color: var(--accent-color, #f44); }
    .ge-drop { height: 96px; display: grid; place-items: center; text-align: center; padding: 4px; border-radius: 10px; cursor: pointer;
      border: 2px dashed rgba(255,255,255,0.3); font-size: 0.75em; line-height: 1.4; opacity: 0.9;
      background: radial-gradient(circle, rgba(255,255,255,0.08) 1.5px, transparent 2px) 0 0 / 14px 14px, rgba(0,0,0,0.35);
      transition: border-color 0.15s, transform 0.15s; }
    .ge-drop:hover, .ge-drop:focus-visible, .ge-slot.is-over .ge-drop { border-color: var(--accent-color, #f44); outline: none; }
    .ge-slot.is-over .ge-drop { transform: scale(1.04); }
    .ge-drop img { max-width: 100%; max-height: 84px; object-fit: contain; }
    .ge-drop img.pixelated { image-rendering: pixelated; }
    .ge-slot-name { font-weight: bold; }
    .ge-slot-hint { font-size: 0.72em; opacity: 0.75; line-height: 1.35; }
    .ge-slot-meta { font-size: 0.72em; opacity: 0.9; min-height: 1.2em; }
    .ge-x { position: absolute; top: -9px; right: -7px; width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--accent-color, #f44);
      background: #111; color: #fff; font: bold 14px/1 monospace; cursor: pointer; padding: 0; }
    .ge-x[hidden] { display: none; }
    .ge-check { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; cursor: pointer; font-size: 0.85em; }
    .ge-msg { min-height: 1.4em; margin-bottom: 10px; font-weight: bold; color: #ffb3b3; }
    .ge-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; }
    .ge-actions .ge-spacer { flex: 1; }
    .ge-btn { padding: 8px 16px; border-radius: 999px; border: 2px solid var(--accent-color, #f44); background: transparent; color: inherit;
      font: bold 0.85em monospace; cursor: pointer; box-shadow: 0 3px 0 var(--accent-color, #f44); transition: transform 0.12s, box-shadow 0.12s; }
    .ge-btn:hover { transform: translateY(-2px) rotate(-1.5deg); }
    .ge-btn:active { transform: translateY(3px); box-shadow: none; }
    .ge-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--url-color, #fff); }
    .ge-btn.ge-primary { background: var(--accent-color, #f44); color: #fff; box-shadow: 0 3px 0 rgba(0,0,0,0.45); }
    .ge-btn.ge-danger { border-color: #ff8a8a; box-shadow: 0 3px 0 #ff8a8a; }
    .ge-btn.ge-danger.is-armed { background: #ff5a5a; color: #fff; }
    .ge-btn[disabled] { opacity: 0.5; pointer-events: none; }
    @media (prefers-reduced-motion: reduce) { .ge-overlay.is-open .ge-panel { animation: none; } .ge-btn:hover, .ge-slot.is-over .ge-drop { transform: none; } }
  `;
  function ensureCss() {
    if (document.getElementById("ge-css")) return;
    const st = document.createElement("style");
    st.id = "ge-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  const kb = (bytes) => `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const bytesOf = (dataUrl) => Math.round((String(dataUrl).length - String(dataUrl).indexOf(",") - 1) * 0.75);

  // A real GIF starts with "GIF87a" or "GIF89a", whatever the file is called.
  async function isGif(file) {
    try {
      const head = new Uint8Array(await file.slice(0, 6).arrayBuffer());
      const s = String.fromCharCode(...head);
      return s === "GIF87a" || s === "GIF89a";
    } catch (_) { return false; }
  }

  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).replace(/^data:[^;,]*/, "data:image/gif"));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function measure(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error("unreadable"));
      img.src = src;
    });
  }

  // Size the loader draws the gif at. Normal gifs shrink to fit the loader
  // (max 192px); small pixel-art gifs grow by whole steps so they stay crisp.
  function displaySize(w, h, pixelated) {
    const max = Math.max(w, h);
    const k = pixelated && max < 128 ? Math.max(1, Math.floor(128 / max)) : Math.min(1, 192 / max);
    return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
  }

  function open(opts = {}) {
    if (pending) return pending;
    const GP = window.GifPacks;
    if (!GP || !GP.saveCustom) return Promise.resolve(null);
    ensureCss();

    const existing = opts.id ? GP.getCustom(opts.id) : null;
    // key -> { src, w, h, bytes }   (w/h = the gif's own size, once measured)
    const draft = {};
    const measuring = [];
    if (existing) {
      for (const { key } of STATES) {
        const s = existing.states[key];
        if (s) draft[key] = { src: s.src, w: null, h: null, bytes: bytesOf(s.src) };
      }
    }

    pending = new Promise((resolve) => {
      const returnTo = document.activeElement;
      const uid = "ge" + Math.random().toString(36).slice(2, 7);

      const overlay = el("div", "ge-overlay");
      const panel = el("div", "ge-panel");
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-labelledby", uid + "t");
      panel.tabIndex = -1;

      const title = el("h2", "ge-title", existing ? "Edit gif pack" : "New gif pack");
      title.id = uid + "t";
      const tip = el("p", "ge-tip",
        "Drop a .gif on each box (or click a box to browse). Skip any you don't have: the default pack fills in. " +
        `Up to ${kb(MAX_BYTES)} each. Your pack stays in this browser.`);

      const nameField = el("label", "ge-field");
      nameField.append(el("span", null, "Pack name"));
      const nameInput = el("input", "ge-input");
      nameInput.type = "text";
      nameInput.maxLength = NAME_MAX;
      nameInput.placeholder = "e.g. My sleepy cat";
      nameInput.value = existing ? existing.name : "";
      nameInput.autocomplete = "off";
      nameField.append(nameInput);

      const slotsEl = el("div", "ge-slots");
      const slots = {};
      STATES.forEach(({ key, label, hint }) => {
        const slot = el("div", "ge-slot");
        const drop = el("div", "ge-drop");
        drop.tabIndex = 0;
        drop.setAttribute("role", "button");
        drop.setAttribute("aria-label", `${label} gif: drop a gif here or press to browse`);
        const ph = el("span", "ge-ph");
        ph.append("drop a .gif", document.createElement("br"), "or click");
        const img = el("img");
        img.alt = "";
        img.hidden = true;
        drop.append(ph, img);
        const meta = el("div", "ge-slot-meta");
        const x = el("button", "ge-x", "×");
        x.type = "button";
        x.hidden = true;
        x.setAttribute("aria-label", `Remove the ${label} gif`);
        const input = el("input");
        input.type = "file";
        input.accept = "image/gif";
        input.hidden = true;
        slot.append(x, drop, el("div", "ge-slot-name", label), el("div", "ge-slot-hint", hint), meta, input);
        slotsEl.append(slot);
        slots[key] = { slot, drop, ph, img, meta, x, input, label };

        const take = (file) => { if (file) setFile(key, file); };
        drop.addEventListener("click", () => input.click());
        drop.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
        });
        input.addEventListener("change", () => { take(input.files[0]); input.value = ""; });
        x.addEventListener("click", (e) => { e.stopPropagation(); delete draft[key]; paintSlot(key); setMsg(""); });
        ["dragenter", "dragover"].forEach((t) => slot.addEventListener(t, (e) => {
          e.preventDefault();
          slot.classList.add("is-over");
        }));
        ["dragleave", "dragend"].forEach((t) => slot.addEventListener(t, () => slot.classList.remove("is-over")));
        slot.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          slot.classList.remove("is-over");
          take(e.dataTransfer?.files?.[0]);
        });
      });

      const crispLabel = el("label", "ge-check");
      const crisp = el("input");
      crisp.type = "checkbox";
      crisp.checked = !!(existing && Object.values(existing.states).some((s) => s.pixelated));
      crispLabel.append(crisp, el("span", null, "Pixel art: keep it crisp when scaled up"));

      const msg = el("div", "ge-msg");
      msg.setAttribute("role", "alert");
      msg.setAttribute("aria-live", "polite");

      const actions = el("div", "ge-actions");
      const delBtn = el("button", "ge-btn ge-danger", "Delete pack");
      const cancelBtn = el("button", "ge-btn", "Cancel");
      const saveBtn = el("button", "ge-btn ge-primary", existing ? "Save changes" : "Create pack");
      [delBtn, cancelBtn, saveBtn].forEach((b) => { b.type = "button"; });
      delBtn.hidden = !existing;
      actions.append(delBtn, el("span", "ge-spacer"), cancelBtn, saveBtn);

      panel.append(title, tip, nameField, slotsEl, crispLabel, msg, actions);
      overlay.append(panel);

      function setMsg(text) { msg.textContent = text; }

      function paintSlot(key) {
        const s = slots[key], d = draft[key];
        if (!s) return;
        s.slot.classList.toggle("has-gif", !!d);
        s.x.hidden = !d;
        s.ph.hidden = !!d;
        s.img.hidden = !d;
        if (d) {
          s.img.src = d.src;
          s.img.classList.toggle("pixelated", crisp.checked);
          s.meta.textContent = `${d.w ? `${d.w}×${d.h} · ` : ""}${kb(d.bytes)}`;
        } else {
          s.img.removeAttribute("src");
          s.meta.textContent = "";
        }
      }
      crisp.addEventListener("change", () => STATES.forEach(({ key }) => paintSlot(key)));

      async function setFile(key, file) {
        setMsg("");
        if (!(await isGif(file))) { setMsg(`"${file.name}" isn't a .gif. Only real GIF files work here.`); return; }
        if (file.size > MAX_BYTES) { setMsg(`That gif is ${kb(file.size)}. The limit is ${kb(MAX_BYTES)} each. Try shrinking or trimming it.`); return; }
        try {
          const src = await readDataUrl(file);
          const m = await measure(src);
          draft[key] = { src, w: m.w, h: m.h, bytes: file.size };
          paintSlot(key);
        } catch (_) {
          setMsg("Couldn't read that gif. Try another file.");
        }
      }

      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        overlay.removeEventListener("keydown", onKey, true);
        overlay.classList.remove("is-open");
        setTimeout(() => overlay.remove(), 180);
        pending = null;
        try { returnTo && returnTo.focus && returnTo.focus({ preventScroll: true }); } catch (_) {}
        resolve(result);
      };

      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); return; }
        if (e.key !== "Tab") return;
        const f = [...panel.querySelectorAll("button:not([hidden]):not([disabled]), input:not([hidden]), [tabindex='0']")]
          .filter((n) => n.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }

      saveBtn.addEventListener("click", async () => {
        setMsg("");
        const name = nameInput.value.trim();
        if (!name) { setMsg("Give your pack a name first."); nameInput.focus(); return; }
        if (!Object.keys(draft).length) { setMsg("Add at least one gif."); return; }
        saveBtn.disabled = true;
        await Promise.all(measuring);
        const states = {};
        for (const key of Object.keys(draft)) {
          const d = draft[key];
          if (!d.w) { try { Object.assign(d, await measure(d.src)); } catch (_) { d.w = d.h = 128; } }
          states[key] = { src: d.src, ...displaySize(d.w, d.h, crisp.checked) };
        }
        const res = GP.saveCustom({ id: existing && existing.id, name, states, pixelated: crisp.checked });
        saveBtn.disabled = false;
        if (!res.ok) { setMsg(res.error || "Couldn't save the pack."); return; }
        finish(res.id);
      });
      cancelBtn.addEventListener("click", () => finish(null));

      // Two clicks to delete: the first arms the button for a few seconds.
      let armTimer = null;
      delBtn.addEventListener("click", () => {
        if (!delBtn.classList.contains("is-armed")) {
          delBtn.classList.add("is-armed");
          delBtn.textContent = "Really delete?";
          armTimer = setTimeout(() => { delBtn.classList.remove("is-armed"); delBtn.textContent = "Delete pack"; }, 3500);
          return;
        }
        clearTimeout(armTimer);
        if (existing && GP.deleteCustom(existing.id)) finish("deleted:" + existing.id);
        else setMsg("Couldn't delete the pack.");
      });

      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) finish(null); });
      overlay.addEventListener("keydown", onKey, true);
      // A gif dropped beside a box shouldn't make the browser open it.
      ["dragover", "drop"].forEach((t) => overlay.addEventListener(t, (e) => e.preventDefault()));

      STATES.forEach(({ key }) => paintSlot(key));
      // An existing pack's gifs show straight away; their own sizes (for the
      // caption and for re-saving) arrive as each one is measured.
      Object.keys(draft).forEach((key) => {
        measuring.push(measure(draft[key].src).then((m) => { Object.assign(draft[key], m); paintSlot(key); }).catch(() => {}));
      });
      document.body.append(overlay);
      requestAnimationFrame(() => { overlay.classList.add("is-open"); (existing ? panel : nameInput).focus({ preventScroll: true }); });
    });
    return pending;
  }

  window.WSGifEditor = { open, states: STATES.map((s) => s.key) };
})();
