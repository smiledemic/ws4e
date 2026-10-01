"use strict";

// ── "R u Sure?" confirm modal ─────────────────────────────────────────
// A reusable yes/no pop-up in the same style as the profile modal (blurred
// polka-dot backdrop, tilted panel, sticker title). Replaces window.confirm.
//
//   const ok = await WSRuSure.ask({
//     title:   "R u Sure?",                 // sticker heading
//     body:    "what happens if they say yes",
//     keep:    "you keep: ...",             // optional dashed "safe" note
//     cancel:  "no take me back!",          // left button (focused first)
//     confirm: "yes clear data",            // right button
//     danger:  true,                        // paint the confirm button loud
//   });                                     // -> true | false
//
// All text is set with textContent (never HTML). Esc / backdrop click /
// the cancel button all answer false. Esc is swallowed so it can't also fire
// the site's panic key. Only one is open at a time; asking again while one
// is up returns the same pending answer.
(() => {
  let pending = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function ask(opts = {}) {
    if (pending) return pending;

    const o = Object.assign({
      title: "R u Sure?", body: "", keep: "",
      cancel: "no take me back!", confirm: "yes", danger: true,
    }, opts);

    pending = new Promise((resolve) => {
      const returnTo = document.activeElement;
      const uid = "rs" + Math.random().toString(36).slice(2, 7);

      const overlay = el("div", "rs-overlay");
      overlay.id = "wsRuSure";
      const panel = el("div", "rs-panel");
      panel.setAttribute("role", "alertdialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-labelledby", uid + "t");
      panel.setAttribute("aria-describedby", uid + "b");
      panel.tabIndex = -1;

      const title = el("h2", "rs-title", o.title);
      title.id = uid + "t";
      const body = el("p", "rs-body", o.body);
      body.id = uid + "b";
      panel.append(title, body);
      if (o.keep) panel.append(el("p", "rs-keep", o.keep));

      const actions = el("div", "rs-actions");
      const noBtn  = el("button", "rs-btn", o.cancel);
      const yesBtn = el("button", "rs-btn rs-yes" + (o.danger ? " rs-danger" : ""), o.confirm);
      noBtn.type = yesBtn.type = "button";
      actions.append(noBtn, yesBtn);
      panel.append(actions);
      overlay.append(panel);

      let done = false;
      const finish = (answer) => {
        if (done) return;
        done = true;
        overlay.removeEventListener("keydown", onKey, true);
        overlay.classList.remove("is-open");
        setTimeout(() => overlay.remove(), 180);
        pending = null;
        try { returnTo && returnTo.focus && returnTo.focus({ preventScroll: true }); } catch (_) {}
        resolve(answer);
      };

      function onKey(e) {
        // Everything typed while this is up belongs to it: keep the site's
        // global shortcuts (Esc = panic, T, R, 0-9 …) from also reacting.
        e.stopImmediatePropagation();
        if (e.key === "Escape") { e.preventDefault(); finish(false); return; }
        if (e.key === "Tab") {
          const f = [noBtn, yesBtn];
          const i = f.indexOf(document.activeElement);
          e.preventDefault();
          f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        }
      }

      noBtn.addEventListener("click", () => finish(false));
      yesBtn.addEventListener("click", () => finish(true));
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) finish(false); });
      overlay.addEventListener("keydown", onKey, true);

      document.body.append(overlay);
      requestAnimationFrame(() => { overlay.classList.add("is-open"); noBtn.focus({ preventScroll: true }); });
    });
    return pending;
  }

  window.WSRuSure = { ask };
})();
