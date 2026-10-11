"use strict";

// ── Debug layout editor ───────────────────────────────────────────────
// Only runs on debug.html (which sets window.__WS_DEBUG before anything
// else). The page renders assets with the normal pipeline (main.js), so the
// grid looks exactly like index; this file only adds editing on top:
//
//   • drag a whole asset block (not just its image) into another grid slot;
//     a dashed slot shows where it will lock in, the others slide aside
//   • hold a dragged block within EDGE px of the left/right screen edge for
//     0.3s to flip a page while still carrying it; while it stays held there
//     it flips again every 0.6s (the wait only applies while dragging)
//   • Ctrl+Z undo, Ctrl+X redo (Ctrl+Y / Ctrl+Shift+Z also redo)
//   • "doPost" sends the new page/order to the sheet backend (data.gs, type=reorder);
//     "Discard changes" goes back to what was loaded
//
// It never edits card contents: it only changes each card's _page / _idx
// (the sort keys paging.js uses) and fires "ws:paging-changed", so main.js
// re-orders and re-renders in place, same as the Settings page does.
(() => {
  if (!window.__WS_DEBUG) return;

  const EDGE = 48, DWELL = 300, REPEAT = 600, THRESH = 5;

  // data.gs build that has the reorder route (WS-DATA-06). An older deployment
  // doesn't know type=reorder: it falls through to the asset feed and answers
  // "Unauthorized.", which looks like a wrong admin key but isn't one.
  const NEED_BUILD = 6;
  const buildOf = (b) => Number(/^WS-DATA-(\d+)$/.exec(String(b || ""))?.[1]) || 0;
  const tailOf  = (u) => "..." + String(u).replace(/\/exec$/, "").slice(-8);
  const $      = (id) => document.getElementById(id);
  const toast  = (m, ms) => window.showToast?.(m, ms);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rerender = () => document.dispatchEvent(new CustomEvent("ws:paging-changed"));

  const undo = [], redo = [];
  let container = null, byId = new Map(), firstCard = null, base = "";
  let edit = true, busy = false, pending = null, drag = null, slot = null;

  // ── Layout model (read from / written to the cards' sort keys) ───────
  function readLayout() {
    const pages = new Map();
    [...(window._allCards || [])]
      .sort((a, b) => a._page - b._page || a._idx - b._idx)
      .forEach((c) => { if (!pages.has(c._page)) pages.set(c._page, []); pages.get(c._page).push(c); });
    return [...pages].sort((a, b) => a[0] - b[0]).map(([page, cards]) => ({ page, cards }));
  }
  const snapStr = () => JSON.stringify(readLayout().map((g) => [g.page, g.cards.map((c) => c._eid)]));

  function writeLayout(lay) {
    let i = 0;
    for (const g of lay.slice().sort((a, b) => a.page - b.page)) {
      for (const c of g.cards) { c._page = g.page; c._idx = i++; c.dataset.page = String(g.page); }
    }
    rerender();
  }

  function applyStr(str) {
    const lay = JSON.parse(str).map(([page, ids]) => ({ page, cards: ids.map((id) => byId.get(id)).filter(Boolean) }));
    writeLayout(lay);
    const pages = lay.filter((g) => g.cards.length).map((g) => g.page);
    if (pages.length && !pages.includes(+window.currentPage)) {
      window.currentPage = pages[0];
      sessionStorage.setItem("currentPage", String(pages[0]));
      window.renderPage?.();
    }
    paint();
  }

  // ── Setup (also re-runs after an R refetch rebuilds the cards) ───────
  function init() {
    const cards = window._allCards || [];
    if (!cards.length) return false;
    container = $("container");
    cards.forEach((c, i) => { c._eid = i; });
    byId = new Map(cards.map((c) => [c._eid, c]));
    firstCard = cards[0];
    undo.length = redo.length = 0;
    base = snapStr();
    document.body.classList.add("dbg-page");
    document.body.classList.toggle("dbg-edit", edit);
    paint();
    return true;
  }

  // ── Dragging ─────────────────────────────────────────────────────────
  const vis = () => [...container.children].filter((el) =>
    el.classList.contains("asset-card") && el !== drag?.card && el.style.display !== "none");

  // Animate the visible cards from where they were to where the change puts them.
  function flip(change) {
    if (reduce) { change(); return; }
    const els = vis(), before = els.map((e) => e.getBoundingClientRect());
    change();
    els.forEach((e, i) => {
      const a = before[i], b = e.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (dx || dy) e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 160, easing: "ease-out" });
    });
  }

  function placeSlot() {
    flip(() => {
      if (drag.before) drag.before.before(slot);
      else {
        const v = vis();
        if (v.length) v[v.length - 1].after(slot); else container.append(slot);
      }
    });
  }

  function position() {
    drag.card.style.left = (drag.x - drag.dx) + "px";
    drag.card.style.top  = (drag.y - drag.dy) + "px";
  }

  // Which card the dragged block should land in front of (null = the end).
  function updateTarget() {
    drag.queued = false;
    const { x, y } = drag, cards = vis(), sr = slot.getBoundingClientRect();
    if (x >= sr.left && x <= sr.right && y >= sr.top && y <= sr.bottom) return;   // already over the slot
    let before = null;
    if (cards.length) {
      let hit = null, best = null, bd = Infinity;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { hit = c; break; }
        const d = (x - (r.left + r.width / 2)) ** 2 + (y - (r.top + r.height / 2)) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      const c = hit || best, r = c.getBoundingClientRect(), cy = r.top + r.height / 2;
      const after = hit ? x >= r.left + r.width / 2
                        : (y > cy + r.height / 2 || (Math.abs(y - cy) <= r.height / 2 && x > r.left + r.width / 2));
      before = after ? (cards[cards.indexOf(c) + 1] || null) : c;
    }
    if (before === drag.before) return;
    drag.before = before;
    placeSlot();
  }

  function startDrag() {
    const card = pending.card, r = card.getBoundingClientRect();
    drag = { card, x: pending.x, y: pending.y, dx: pending.x - r.left, dy: pending.y - r.top,
             prev: snapStr(), origin: { page: card._page, idx: card._idx },
             side: 0, at: 0, span: DWELL, before: undefined, queued: false, raf: 0 };
    pending = null;
    slot = document.createElement("div");
    slot.className = "dbg-slot";
    slot.style.height = r.height + "px";
    card.before(slot);
    card.classList.add("dbg-dragging");
    card.style.width  = r.width + "px";
    card.style.height = r.height + "px";
    position();
    document.body.classList.add("dbg-active");
    drag.raf = requestAnimationFrame(tick);
  }

  function flipPage(dir) {
    const pages = [...window._cardIndex.keys()].sort((a, b) => a - b);
    const cur = +window.currentPage, i = pages.indexOf(cur);
    if (i < 0 || (dir > 0 && i === pages.length - 1) || (dir < 0 && i === 0)) return false;   // no wrap-around while editing
    dir > 0 ? window.nextPage() : window.prevPage();
    if (+window.currentPage === cur) return false;
    // Carry the block onto the new page so it stays visible and lands there.
    const c = drag.card;
    c._page = +window.currentPage;
    c._idx  = 1e9;
    c.dataset.page = String(c._page);
    rerender();
    drag.before = null;
    placeSlot();
    return true;
  }

  // Edge-hold page flipping: 0.3s first, then every 0.6s while still held.
  function tick(now) {
    if (!drag) return;
    const side = drag.x <= EDGE ? -1 : drag.x >= innerWidth - EDGE ? 1 : 0;
    if (side !== drag.side) { drag.side = side; drag.span = DWELL; drag.at = side ? now + DWELL : 0; }
    else if (side && now >= drag.at) { flipPage(side); drag.span = REPEAT; drag.at = now + REPEAT; }
    const p = side ? Math.min(1, Math.max(0, 1 - (drag.at - now) / drag.span)) : 0;
    for (const [id, s] of [["dbgEdgeL", -1], ["dbgEdgeR", 1]]) {
      const el = $(id);
      if (!el) continue;
      el.classList.toggle("on", side === s);
      el.style.setProperty("--p", side === s ? p.toFixed(3) : "0");
    }
    drag.raf = requestAnimationFrame(tick);
  }

  function endDrag(commit) {
    const d = drag, c = d.card;
    drag = null;
    cancelAnimationFrame(d.raf);
    document.body.classList.remove("dbg-active");
    $("dbgEdgeL")?.classList.remove("on");
    $("dbgEdgeR")?.classList.remove("on");
    c.classList.remove("dbg-dragging");
    for (const p of ["width", "height", "left", "top"]) c.style.removeProperty(p);
    slot.remove();
    slot = null;

    if (!commit) {                                   // Esc / cancelled: put it back
      c._page = d.origin.page; c._idx = d.origin.idx; c.dataset.page = String(c._page);
      rerender(); paint();
      return;
    }
    const lay = readLayout();
    lay.forEach((g) => { const i = g.cards.indexOf(c); if (i > -1) g.cards.splice(i, 1); });
    const page = +window.currentPage;
    let g = lay.find((x) => x.page === page);
    if (!g) { g = { page, cards: [] }; lay.push(g); }
    const at = d.before ? g.cards.indexOf(d.before) : -1;
    g.cards.splice(at < 0 ? g.cards.length : at, 0, c);
    writeLayout(lay);
    if (snapStr() !== d.prev) { undo.push(d.prev); redo.length = 0; }
    paint();
  }

  function onDown(e) {
    if (!edit || busy || drag || e.button > 0) return;
    const card = e.target.closest?.("#container .asset-card");
    if (!card || !byId.has(card._eid)) return;
    e.preventDefault();                              // no text/image selection while dragging
    pending = { card, x: e.clientX, y: e.clientY };
  }
  function onMove(e) {
    if (pending && !drag) {
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < THRESH) return;
      startDrag();
    }
    if (!drag) return;
    drag.x = e.clientX; drag.y = e.clientY;
    position();
    if (!drag.queued) { drag.queued = true; requestAnimationFrame(updateTarget); }
  }
  const onUp = () => { pending = null; if (drag) endDrag(true); };

  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", () => { pending = null; if (drag) endDrag(false); });
  // Edit mode: a click on a block never opens, favorites or downloads it.
  document.addEventListener("click", (e) => {
    if (edit && e.target.closest?.("#container .asset-card")) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // ── Undo / redo / discard ────────────────────────────────────────────
  function doUndo() { if (drag || busy || !undo.length) return; redo.push(snapStr()); applyStr(undo.pop()); }
  function doRedo() { if (drag || busy || !redo.length) return; undo.push(snapStr()); applyStr(redo.pop()); }
  function doDiscard() {
    if (drag || busy || snapStr() === base) return;
    if (!confirm("Discard all unsaved layout changes?")) return;
    undo.length = redo.length = 0;
    applyStr(base);
    toast("Changes discarded");
  }

  // Capture on window so Esc cancels a drag instead of firing the panic redirect.
  window.addEventListener("keydown", (e) => {
    if (drag && e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); endDrag(false); return; }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (/^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if (k === "x" || k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); doRedo(); }
  }, true);

  // ── doPost ───────────────────────────────────────────────────────────
  const rowsOf = (c) => c._versions
    ? c._versions.map((v) => ({ link: v.m.linkTrim, title: v.m.title }))
    : [{ link: (c.querySelector("a.asset-link")?.getAttribute("href") || "").trim(), title: c._title }];

  async function doPost() {
    if (drag || busy || snapStr() === base) return;
    const keyEl = $("dbgKey");
    const key = keyEl.value.trim() || sessionStorage.getItem("dbgAdminKey") || "";
    if (!key) { toast("Enter your admin key first", 2800); keyEl.focus(); return; }
    const layout = readLayout().map((g) => ({ page: g.page, rows: g.cards.flatMap(rowsOf) }));
    const total  = layout.reduce((n, g) => n + g.rows.length, 0);
    if (!confirm(`Write ${total} assets across ${layout.length} pages to the sheet?\n(The backend keeps a backup tab first.)`)) return;

    const url = window.WS_ENDPOINTS.data;
    busy = true; paint("Checking backend...");
    try {
      // Which build is behind the DATA url? (type=build needs no ticket.) If the
      // check itself fails, carry on: the POST below will report the real error.
      let build = "";
      try {
        const r = await fetch(`${url}?type=build&_=${Date.now()}`, { cache: "no-store" });
        build = String((await r.json())?.build || "");
      } catch (_) {}
      console.info("[debug] DATA endpoint", tailOf(url), "build:", build || "(no answer)");
      if (build && buildOf(build) < NEED_BUILD) {
        throw new Error(`${tailOf(url)} is running ${build}, but reorder needs WS-DATA-0${NEED_BUILD} or newer. Deploy the merged data.gs and use that /exec URL in endpoints.js`);
      }

      paint("Posting...");
      const t = localStorage.getItem("ws_ticket_id"), k = localStorage.getItem("ws_ticket_key");
      const qs = new URLSearchParams({ type: "reorder", ...(t ? { ticket: t } : {}), ...(k ? { key: k } : {}), _: Date.now() });
      // No Content-Type header: text/plain is a simple request, so no CORS preflight (same as ticket.js).
      const res = await fetch(`${url}?${qs}`, {
        method: "POST", body: JSON.stringify({ type: "reorder", adminKey: key, layout }), cache: "no-store",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      let out;
      try { out = JSON.parse(await res.text()); }
      catch (_) { throw new Error(`${tailOf(url)} didn't answer with JSON. Check the deployment is shared with "Anyone"`); }
      if (!out?.ok) {
        if (out?.error === "bad admin key") sessionStorage.removeItem("dbgAdminKey");
        // Unknown POST types land in the asset feed, which answers like this.
        if (out?.error === "Unauthorized.") throw new Error(`${tailOf(url)} has no reorder route (build ${build || "unknown"}). Redeploy the merged data.gs`);
        throw new Error(out?.error || "backend refused the request");
      }
      sessionStorage.setItem("dbgAdminKey", key);   // only a key the backend accepted is remembered
      toast(out.unmatched ? `Saved ${out.moved}. ${out.unmatched} rows weren't found in the sheet.` : `Saved ${out.moved} assets to the sheet`, 3600);
      undo.length = redo.length = 0;
      base = snapStr();
      busy = false; paint();
      if (window.reloadAssets) { firstCard = null; await window.reloadAssets(); }   // watcher below re-inits on the fresh cards
    } catch (err) {
      console.error("[debug] doPost failed:", err);
      toast("doPost failed: " + (err.message || err), 7000);
    } finally {
      busy = false; paint();
    }
  }

  // ── Overlay ──────────────────────────────────────────────────────────
  function paint(msg) {
    const dirty = !!base && snapStr() !== base, st = $("dbgStatus");
    if (st) {
      st.textContent = msg || (dirty ? `${undo.length} change${undo.length === 1 ? "" : "s"} not saved` : "No changes");
      st.classList.toggle("dirty", dirty);
    }
    if ($("dbgUndo"))    $("dbgUndo").disabled    = busy || !undo.length;
    if ($("dbgRedo"))    $("dbgRedo").disabled    = busy || !redo.length;
    if ($("dbgDiscard")) $("dbgDiscard").disabled = busy || !dirty;
    if ($("dbgPost"))    $("dbgPost").disabled    = busy || !dirty;
    window.__wsDebugDirty = dirty;
  }

  $("dbgUndo")?.addEventListener("click", doUndo);
  $("dbgRedo")?.addEventListener("click", doRedo);
  $("dbgDiscard")?.addEventListener("click", doDiscard);
  $("dbgPost")?.addEventListener("click", doPost);
  $("dbgEditToggle")?.addEventListener("change", (e) => {
    edit = e.target.checked;
    document.body.classList.toggle("dbg-edit", edit);
  });
  const savedKey = sessionStorage.getItem("dbgAdminKey");
  if (savedKey && $("dbgKey")) $("dbgKey").value = savedKey;
  window.addEventListener("beforeunload", (e) => { if (window.__wsDebugDirty) { e.preventDefault(); e.returnValue = ""; } });

  // Start once the cards exist, and again whenever main.js rebuilds them (R refetch).
  setInterval(() => {
    if (drag) return;
    const cs = window._allCards;
    if (cs && cs.length && cs[0] !== firstCard) init();
  }, 400);
})();