"use strict";

(function injectQuoteStyles() {
  if (document.getElementById("_qs-styles")) return;
  const style = document.createElement("style");
  style.id = "_qs-styles";
  style.textContent = `
    #quoteBox,
    #quoteBox * {
      font-family: monospace !important;
      font-weight: 600 !important;
      box-sizing: border-box;
    }
    .qs-anchor {
      cursor: pointer;
      transition: color 0.15s, opacity 0.15s;
    }
    .qs-anchor:hover { opacity: 0.8; }

    .qs-anim-shake,
    .qs-anim-wave,
    .qs-anim-jumpy,
    .qs-anim-tremble,
    .qs-anim-crawl,
    .qs-anim-sparkle { display: inline; }

    .qs-char {
      display: inline-block;
      white-space: pre;
    }

    /* **bold** / *italic*. The box is already weight 600 (which most
       monospace fonts draw with their bold face), so bold also gets a thin
       stroke to stand out from the regular text. */
    #quoteBox .qs-b, .qs-b {
      font-weight: 900 !important;
      -webkit-text-stroke: 0.035em currentColor;
    }
    #quoteBox .qs-i, .qs-i { font-style: italic; }

    /* sparkle: every letter glints in turn, and some get a twinkling ✦. */
    .qs-char.qs-spark { position: relative; }
    .qs-char.qs-spark::after {
      content: "✦";
      position: absolute;
      top: -0.55em;
      right: -0.35em;
      font-size: 0.6em;
      color: #fff;
      text-shadow: 0 0 4px #fff, 0 0 8px currentColor;
      pointer-events: none;
      opacity: 0;
      animation: _qs-twinkle 2.4s ease-in-out infinite;
      animation-delay: var(--qs-spark-delay, 0s);
    }

    @keyframes _qs-shake {
      0%,100% { transform: translateX(0); }
      20%     { transform: translateX(-3px); }
      40%     { transform: translateX(3px); }
      60%     { transform: translateX(-2px); }
      80%     { transform: translateX(2px); }
    }
    @keyframes _qs-wave {
      0%,100% { transform: translateY(0); }
      25%     { transform: translateY(-5px); }
      75%     { transform: translateY(5px); }
    }
    @keyframes _qs-jumpy {
      0%,55%,100% { transform: translateY(0); }
      35%         { transform: translateY(-10px); }
      45%         { transform: translateY(-7px); }
    }
    @keyframes _qs-tremble {
      0%   { transform: translate(0,0) rotate(0deg); }
      15%  { transform: translate(-1px, 1px) rotate(-0.5deg); }
      30%  { transform: translate(1px,-1px) rotate(0.5deg); }
      45%  { transform: translate(-1px,-1px) rotate(0deg); }
      60%  { transform: translate(1px, 1px) rotate(0.5deg); }
      75%  { transform: translate(0,-1px) rotate(-0.5deg); }
      90%  { transform: translate(-1px,0) rotate(0deg); }
      100% { transform: translate(0,0) rotate(0deg); }
    }
    @keyframes _qs-crawl {
      0%,100% { transform: translateY(0); }
      50%     { transform: translateY(-3px); }
    }
    @keyframes _qs-sparkle {
      0%,70%,100% { text-shadow: none; filter: brightness(1); }
      80%         { text-shadow: 0 0 4px #fff, 0 0 10px currentColor; filter: brightness(1.7); }
    }
    @keyframes _qs-twinkle {
      0%,65%,100% { opacity: 0; transform: scale(0) rotate(0deg); }
      78%         { opacity: 1; transform: scale(1) rotate(90deg); }
      90%         { opacity: 0.6; transform: scale(0.6) rotate(180deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .qs-char.qs-spark::after { animation: none; }
    }

    .quote-sticker {
      display: inline-block;
      vertical-align: middle;
      max-height: 1.6em;
      width: auto;
    }

    #quoteWrapper.qs-mode-refresh {
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: visible;
    }
    #quoteWrapper.qs-mode-refresh #quoteBox {
      white-space: normal;
      text-align: center;
      transform: none !important;
    }
  `;
  document.head.appendChild(style);
})();

// ── Quote formatting ───────────────────────────────────────────────────
// Turns a quote cell into HTML. Shared by the quote box below and the
// quote builder (tools/stickers.html), so the builder shows exactly what
// the site will. Supported, in the order they're applied:
//
//   [{c:#f44;u:true;type:wave;sp:120,70,30}]text[/]   colour / underline /
//        effect (shake wave jumpy tremble crawl sparkle) / scroll speeds
//   [a{src:https://…;ac:#hex;u:true}]text[/a]  or  [a]text[/a]   link
//   [audbox{src:…;vol:80%;start:1;end:5}]text[/audbox]   audio clip
//   :pack/file.ext:  or  :name:   sticker (stickers.js)
//   **bold**   *italic*   \* for a literal asterisk
//
// window.WS_QuoteFormat = {
//   EFFECTS: [...effect names],
//   parse(text, { onAudio(src, vol0to1, startSec, endSec) }) -> html
//   animate(el)       splits effect spans into per-letter animated spans
//   bindAnchors(el)   click / hover-colour for [a] links inside el
//   render(el, text, opts) = parse + animate into el
// }
(() => {
  const EFFECTS = ["shake", "wave", "jumpy", "tremble", "crawl", "sparkle"];
  const EFFECT_SET = new Set(EFFECTS);

  const ANIM_CONFIG = {
    shake:   { kf: "_qs-shake",   dur: "0.4s",  ease: "ease-in-out", step: 40  },
    wave:    { kf: "_qs-wave",    dur: "1.2s",  ease: "ease-in-out", step: 80  },
    jumpy:   { kf: "_qs-jumpy",   dur: "0.8s",  ease: "ease-in-out", step: 60  },
    tremble: { kf: "_qs-tremble", dur: "0.25s", ease: "linear",      step: 20  },
    crawl:   { kf: "_qs-crawl",   dur: "2.5s",  ease: "ease-in-out", step: 120 },
    sparkle: { kf: "_qs-sparkle", dur: "2.4s",  ease: "ease-in-out", step: 90  },
  };

  function parseStyleProps(raw) {
    const props = {};
    (raw || "").split(";").forEach(part => {
      const eq = part.indexOf(":");
      if (eq < 1) return;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k) props[k] = v;
    });
    return props;
  }

  // :pack/file.ext: or :name: → the sticker image (stickers.js resolves
  // it, ignoring case). Anything that isn't a sticker stays as typed, and
  // an image that fails to load turns back into its text.
  function buildStickerImg(ref) {
    const src = window.WS_Stickers?.src(ref);
    if (!src) return `:${ref}:`;
    return `<img src="${src}" class="quote-sticker" alt=":${ref}:" title=":${ref}:" loading="lazy" onerror="this.replaceWith(document.createTextNode(this.alt))">`;
  }

  // **bold** and *italic*, on the text only: tags already written are
  // swapped for placeholders first, so an asterisk inside an attribute is
  // never touched and bold can wrap styled spans and stickers.
  // New tags are placeholders too, so a later pass can't match across them.
  // Markers must hug their text (** no ** stays as typed), and a lone * never
  // pairs with half of a **.
  function applyEmphasis(html) {
    const tags = [];
    const T = (t) => `\u0000${tags.push(t) - 1}\u0000`;
    let s = html.replace(/<[^>]*>/g, T);
    s = s.replace(/\\\*/g, "\u0001");
    s = s.replace(/\*\*\*(?=[^\s*])([\s\S]*?[^\s*])\*\*\*/g, (_, x) => T('<strong class="qs-b"><em class="qs-i">') + x + T("</em></strong>"));
    s = s.replace(/\*\*(?=[^\s*])([\s\S]*?[^\s*])\*\*/g, (_, x) => T('<strong class="qs-b">') + x + T("</strong>"));
    s = s.replace(/(?<!\*)\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/g, (_, x) => T('<em class="qs-i">') + x + T("</em>"));
    s = s.replace(/\u0001/g, "*");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tags[i]);
  }

  function parse(text, opts = {}) {
    let out = String(text ?? "");

    out = out.replace(
      /\[\{([^}]*)\}\]([\s\S]*?)\[\/\]/g,
      (_, rawProps, inner) => {
        const props = parseStyleProps(rawProps);
        const css   = [];
        const data  = {};
        if (props.c)  css.push(`color:${props.c}`);
        if (props.u === "true") css.push("text-decoration:underline");
        if (props.type && EFFECT_SET.has(props.type)) data.anim = props.type;
        if (props.sp)  data.sp = props.sp;

        const styleAttr = css.length ? ` style="${css.join(";")}"` : "";
        const dataAttrs = Object.entries(data)
          .map(([k, v]) => `data-qs-${k}="${String(v).replace(/"/g, "&quot;")}"`)
          .join(" ");
        const animClass = data.anim ? ` qs-anim-${data.anim}` : "";
        return `<span class="qs-styled${animClass}"${styleAttr}${dataAttrs ? " " + dataAttrs : ""}>${inner}</span>`;
      }
    );

    out = out.replace(
      /\[a\{([^}]*)\}\]([\s\S]*?)\[\/a\]/g,
      (_, rawProps, inner) => {
        const props = parseStyleProps(rawProps);
        const css   = [];
        if (props.u === "true") css.push("text-decoration:underline");
        const accentAttr = props.ac  ? ` data-qs-ac="${props.ac}"`   : "";
        const srcAttr    = props.src ? ` data-qs-src="${props.src}"` : "";
        const styleAttr  = css.length ? ` style="${css.join(";")}"` : "";
        return `<span class="qs-anchor"${styleAttr}${accentAttr}${srcAttr}>${inner}</span>`;
      }
    );
    out = out.replace(
      /\[a\]([\s\S]*?)\[\/a\]/g,
      (_, inner) => `<span class="qs-anchor">${inner}</span>`
    );

    out = out.replace(
      /\[audbox\{([^}]*)\}\]([\s\S]*?)\[\/audbox\]/g,
      (_, rawProps, inner) => {
        const props    = parseStyleProps(rawProps);
        const src      = props.src || "";
        const vol      = parseFloat(props.vol || "100%") / 100;
        const startSec = props.start ? parseFloat(props.start) : 0;
        const endSec   = props.end   ? parseFloat(props.end)   : 0;
        if (src) opts.onAudio?.(src, isNaN(vol) ? 1 : Math.min(Math.max(vol, 0), 1), startSec, endSec || undefined);
        return `<span class="qs-audbox" data-qs-src="${src}" data-qs-vol="${props.vol || "100%"}">${inner}</span>`;
      }
    );

    // Stickers. Only the text between tags is touched, so a colon inside an
    // attribute the styling tags above wrote (style="color:…") is left alone.
    out = out.replace(/(<[^>]*>)|:([\w\-]+(?:\/[\w\-]+)?(?:\.(?:png|gif|webp|jpe?g))?):/gi,
      (match, tag, ref) => tag ? tag : buildStickerImg(ref));

    return applyEmphasis(out);
  }

  // Each effect span's letters become their own animated spans, staggered
  // by the effect's step. Walks into bold/italic/links inside the span, and
  // runs innermost-first so a nested effect keeps its own animation.
  function animate(containerEl) {
    [...containerEl.querySelectorAll("[data-qs-anim]")].reverse().forEach(spanEl => {
      const anim = spanEl.dataset.qsAnim;
      const cfg  = ANIM_CONFIG[anim];
      if (!cfg) return;

      const animDecl = `${cfg.kf} ${cfg.dur} ${cfg.ease} infinite`;
      let charIndex  = 0;

      const walk = (parent) => {
        [...parent.childNodes].forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            const frag = document.createDocumentFragment();
            for (const ch of node.textContent) {
              const charSpan = document.createElement("span");
              charSpan.className            = "qs-char";
              charSpan.textContent          = ch;
              charSpan.style.animation      = animDecl;
              charSpan.style.animationDelay = `${charIndex * cfg.step}ms`;
              // sparkle: a ✦ on every third letter, twinkling out of step.
              if (anim === "sparkle" && /\S/.test(ch) && charIndex % 3 === 0) {
                charSpan.classList.add("qs-spark");
                charSpan.style.setProperty("--qs-spark-delay", `${(charIndex * 737) % 2400}ms`);
              }
              frag.appendChild(charSpan);
              charIndex++;
            }
            node.replaceWith(frag);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === "IMG" || node.dataset.qsAnim || node.classList.contains("qs-char")) { charIndex++; return; }
            walk(node);
          }
        });
      };
      walk(spanEl);
    });
  }

  function bindAnchors(el) {
    el.addEventListener("click", (e) => {
      const anchor = e.target.closest(".qs-anchor");
      if (!anchor) return;
      const src = anchor.dataset.qsSrc;
      if (src) window.open(src, "_blank", "noopener,noreferrer");
    });
    el.addEventListener("mouseover", (e) => {
      const anchor = e.target.closest(".qs-anchor");
      const ac = anchor?.dataset.qsAc;
      if (ac) anchor.style.color = ac;
    });
    el.addEventListener("mouseout", (e) => {
      const anchor = e.target.closest(".qs-anchor");
      if (anchor) anchor.style.color = "";
    });
  }

  function render(el, text, opts) {
    el.innerHTML = parse(text, opts);
    animate(el);
  }

  window.WS_QuoteFormat = { EFFECTS, parse, animate, bindAnchors, render };
})();

// ── Quote settings ─────────────────────────────────────────────────────
// Set on the Settings page (pages/settings.html, "Quotes"), read by the
// quote bar below. Saved per browser:
//
//   ws_quote_keep   "1" = switching the Qtype keeps the quote that's on
//                   screen (default off: every switch shows a new quote).
//                   A quote that's fully off screen is replaced either way.
//
// Kept apart from WS_Paging on purpose: a paging change re-sorts the whole
// library (main.js), which a quote setting shouldn't do. Changes (here, or
// from another tab) fire "ws:quote-settings-changed" on document.
(() => {
  const KEYS     = { keepOnSwitch: "ws_quote_keep" };
  const DEFAULTS = { keepOnSwitch: false };

  const read = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const get  = () => ({ keepOnSwitch: read(KEYS.keepOnSwitch) === "1" });
  const changed = () => document.dispatchEvent(new CustomEvent("ws:quote-settings-changed", { detail: get() }));

  function set(name, value) {
    if (!(name in KEYS)) return;
    try {
      if (value) localStorage.setItem(KEYS[name], "1");
      else localStorage.removeItem(KEYS[name]);
    } catch (_) { return; }
    changed();
  }
  function reset() {
    try { Object.values(KEYS).forEach((k) => localStorage.removeItem(k)); } catch (_) {}
    changed();
  }

  window.addEventListener("storage", (e) => {
    if (e.key === null || Object.values(KEYS).includes(e.key)) changed();
  });

  window.WS_QuoteSettings = { KEYS, DEFAULTS, get, set, reset };
})();

document.addEventListener("DOMContentLoaded", () => {
  const wrapper = document.getElementById("quoteWrapper");
  const box     = document.getElementById("quoteBox");
  if (!wrapper || !box) return;

  const SHEETS_URL = `${window.WS_ENDPOINTS.data}?type=quotes`;   // endpoints.js


  let LOCAL_QUOTES  = [];
  let seenIndices   = new Set();
  let pendingQuotes = null;
  let fetchInFlight = false;

  const QTYPES      = ["Qleft", "Qright", "Qrefresh"];
  const QTYPE_ICONS = {
    Qleft:    "assets/media/images/qtypes-btn/Qleft.png",
    Qright:   "assets/media/images/qtypes-btn/Qright.png",
    Qrefresh: "assets/media/images/qtypes-btn/Qrefresh.png",
  };
  const QTYPE_KEY = "ws_qtype";

  // A saved value from an older/edited build would leave no icon and no mode.
  let currentQtype = localStorage.getItem(QTYPE_KEY);
  if (!QTYPES.includes(currentQtype)) currentQtype = "Qleft";
  let refreshQuote = null;
  let currentText  = null;   // the real quote on show (not "Loading quotes…")

  function applyQtypeIcon() {
    const img = document.getElementById("QtypeToggle");
    if (img) img.src = QTYPE_ICONS[currentQtype];
  }

  // Is any of the quote showing right now? Refresh mode always shows it; a
  // scrolling quote is off screen while it waits to enter (images/audio
  // still loading) or once it's past either edge.
  function quoteOnScreen(mode) {
    if (currentText === null) return false;
    if (mode === "Qrefresh") return true;
    if (!_quoteReady) return false;
    return pos < wrapper.offsetWidth && pos + box.offsetWidth > 0;
  }

  // Keep-quote switch: same quote, same letters and audio, just a new mode.
  // Left <-> right reverses from where it is; into refresh it centres; out
  // of refresh it starts scrolling from where it sat centred.
  function switchKeepingQuote(from) {
    const left = box.getBoundingClientRect().left - wrapper.getBoundingClientRect().left;
    if (currentQtype === "Qrefresh") {
      refreshQuote = currentText;
      wrapper.classList.add("qs-mode-refresh");
      box.style.transform = "translateX(0)";
    } else {
      refreshQuote = null;
      if (from === "Qrefresh") {
        // Leaving refresh changes where the box sits with no transform, so
        // measure that and offset from it to stay put on screen.
        wrapper.classList.remove("qs-mode-refresh");
        box.style.transform = "translateX(0)";
        pos = left - (box.getBoundingClientRect().left - wrapper.getBoundingClientRect().left);
        box.style.transform = `translateX(${pos}px)`;
      }
    }
    _quoteReady = true;
    lastTime    = null;
  }

  function cycleQtype() {
    const from   = currentQtype;
    const idx    = QTYPES.indexOf(currentQtype);
    currentQtype = QTYPES[(idx + 1) % QTYPES.length];
    localStorage.setItem(QTYPE_KEY, currentQtype);
    applyQtypeIcon();

    if (window.WS_QuoteSettings?.get().keepOnSwitch && quoteOnScreen(from)) {
      switchKeepingQuote(from);
      return;
    }

    if (currentQtype !== "Qrefresh") refreshQuote = null;
    stopAudio();
    setQuote();
  }

  window.WS_Quotes = { cycleQtype };

  document.querySelector(".Qtype")?.addEventListener("click", cycleQtype);

  applyQtypeIcon();

function parseQuotes(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const keys = Object.keys(data);
  if (keys.length !== 1) {
    return null;
  }

  const values = data[keys[0]];

  if (!Array.isArray(values)) {
    return null;
  }

  const result = values
    .filter(value => value !== null && value !== undefined && String(value).trim() !== "")
    .map(value => String(value));

  return result.length > 0 ? result : null;
}

  // Data cache (datacache.js): while it's on, quotes come from the saved
  // copy and only an R refetch (`force`) goes back to DATA.
  const cacheOn = () => !!window.WS_DataCache?.enabled();

  function backgroundRefetch(force = false) {
    if (fetchInFlight || (cacheOn() && !force)) return;
    fetchInFlight = true;
    ticketReady()
      .then(() => fetchJSONRetry(() => bustCache(SHEETS_URL)))
      .then(data => {
        const fresh = parseQuotes(data);
        if (!fresh) return;
        pendingQuotes = fresh;
        if (cacheOn()) window.WS_DataCache.write("quotes", data);
      })
      .catch((err) => { console.error("[Quotes] Background refetch failed:", err); })
      .finally(() => { fetchInFlight = false; });
  }

  let _audCtx     = null;
  let _audSource   = null;
  let _audGain     = null;
  let _audPanner   = null;
  let _audBuffer   = null;
  let _audSrc      = null;
  let _audVol      = 1.0;
  let _audPanAnim  = null;
  let _audLoopStart = 0;
  let _audLoopEnd   = 0;
  let _audStartedAt = 0;
  let _audLoopTimer = null;
  let _audReadyPromise = null;
  let _audFetchCtrl    = null;

  let _audioUnlocked = false;

  function unlockAudio() {
    if (_audioUnlocked) return;
    _audioUnlocked = true;
    if (!_audCtx) _audCtx = new AudioContext();
    _audCtx.resume();
  }

  document.addEventListener("click", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });

  function _clearLoopTimer() {
    if (_audLoopTimer !== null) { clearTimeout(_audLoopTimer); _audLoopTimer = null; }
  }

  function stopAudio() {
    _clearLoopTimer();
    if (_audFetchCtrl) { _audFetchCtrl.abort(); _audFetchCtrl = null; }
    if (_audSource)    { try { _audSource.stop(); } catch (_) {} _audSource = null; }
    if (_audPanAnim)   { cancelAnimationFrame(_audPanAnim); _audPanAnim = null; }
    _audBuffer = null;
    _audSrc    = null;
  }

  function _spawnSource() {
    if (!_audCtx || !_audBuffer || !_audPanner || !_audGain) return;
    _clearLoopTimer();
    if (_audSource) { try { _audSource.stop(); } catch (_) {} }

    _audSource        = _audCtx.createBufferSource();
    _audSource.buffer = _audBuffer;
    _audSource.loop   = false;
    _audSource.connect(_audPanner).connect(_audGain).connect(_audCtx.destination);
    _audSource.start(0, _audLoopStart);
    _audStartedAt = _audCtx.currentTime;

    const clipLen = _audLoopEnd - _audLoopStart;
    _audLoopTimer = setTimeout(_spawnSource, clipLen * 1000);
  }

  function prepareAudio(src, vol, startSec, endSec) {
    if (!src) return Promise.resolve();
    if (!_audioUnlocked) return Promise.resolve();
    _audSrc = src;
    _audVol = vol;

    return new Promise(async (resolve) => {
      try {
        if (!_audCtx) _audCtx = new AudioContext();
        if (_audCtx.state === "suspended") await _audCtx.resume();

        if (_audFetchCtrl) { _audFetchCtrl.abort(); _audFetchCtrl = null; }
        const ctrl = new AbortController();
        _audFetchCtrl = ctrl;

        const response = await fetch(src, { signal: ctrl.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuf = await response.arrayBuffer();

        if (_audFetchCtrl !== ctrl) { resolve(); return; }
        _audFetchCtrl = null;

        _audBuffer = await _audCtx.decodeAudioData(arrayBuf);

        const dur     = _audBuffer.duration;
        _audLoopStart = Math.min(Math.max(startSec || 0, 0), dur);
        _audLoopEnd   = endSec ? Math.min(Math.max(endSec, _audLoopStart + 0.1), dur) : dur;

        _audPanner          = _audCtx.createStereoPanner();
        _audGain            = _audCtx.createGain();
        _audGain.gain.value = 0;

        _spawnSource();
        startPanVolumeAnimation();
        resolve();
      } catch (e) {
        if (e?.name !== "AbortError") console.warn("[audbox] Failed to load/play audio:", e);
        _audFetchCtrl = null;
        resolve();
      }
    });
  }

  function startAudio(src, vol, startSec, endSec) {
    if (!src || !_audioUnlocked) return;
    _audReadyPromise = prepareAudio(src, vol, startSec, endSec);
  }

  const _panWrapper = wrapper;
  const _panBox     = box;

  function startPanVolumeAnimation() {
    if (_audPanAnim) cancelAnimationFrame(_audPanAnim);

    const animatePanVol = () => {
      if (!_audPanner || !_audGain || !_audSource) return;

      const ww = _panWrapper.offsetWidth || window.innerWidth;
      // Where the box really is: refresh mode centres it with CSS (its
      // transform says 0), and a kept quote can change modes mid-scroll.
      const bx = _panBox.getBoundingClientRect().left - _panWrapper.getBoundingClientRect().left;
      const bw = _panBox.offsetWidth || 0;
      const cx = bx + bw / 2;

      _audPanner.pan.value = Math.max(-1, Math.min(1, (cx / ww) * 2 - 1));

      const fadeZone      = Math.max(ww * 0.18, 80);
      const entryProgress = Math.min(1, Math.max(0, (ww - bx) / fadeZone));
      const exitProgress  = Math.min(1, Math.max(0, (bx + bw) / fadeZone));
      const targetVol = window._quotesMuted
        ? 0
        : _audVol * Math.min(entryProgress, exitProgress);
      _audGain.gain.value = targetVol;

      _audPanAnim = requestAnimationFrame(animatePanVol);
    };

    _audPanAnim = requestAnimationFrame(animatePanVol);
  }

  window.WS_QuoteFormat.bindAnchors(box);

  const SPEED_BASE   = 120;
  const SPEED_SLOW   = 70;
  const SPEED_SLOWER = 30;

  let _customSpeeds  = null;
  let pos            = 0;
  let lastTime       = null;
  let currentSpeed   = SPEED_BASE;
  let isHoveringBox  = false;
  let isHoveringText = false;
  let isMouseDown    = false;

  function readCustomSpeeds(boxEl) {
    const span = boxEl.querySelector("[data-qs-sp]");
    if (!span) { _customSpeeds = null; return; }
    const parts = span.dataset.qsSp.split(",").map(s => parseFloat(s.trim()));
    _customSpeeds = (parts.length >= 3 && parts.every(n => !isNaN(n))) ? parts : null;
  }

  const updateSpeed = () => {
    const s = _customSpeeds
      ? { base: _customSpeeds[0], slow: _customSpeeds[1], slower: _customSpeeds[2] }
      : { base: SPEED_BASE, slow: SPEED_SLOW, slower: SPEED_SLOWER };
    if (isMouseDown)         currentSpeed = 0;
    else if (isHoveringText) currentSpeed = s.slower;
    else if (isHoveringBox)  currentSpeed = s.slow;
    else                     currentSpeed = s.base;
  };

  let lastIdx = -1;

  function waitForQuoteReady(containerEl, imgTimeoutMs = 5000, audTimeoutMs = 12000) {
    const imgs = [...containerEl.querySelectorAll("img")];
    const imgPromise = imgs.length
      ? new Promise((resolve) => {
          let remaining = imgs.length;
          const done = () => { if (--remaining === 0) resolve(); };
          setTimeout(resolve, imgTimeoutMs);
          imgs.forEach(img => {
            if (img.complete) { done(); return; }
            img.addEventListener("load",  done, { once: true });
            img.addEventListener("error", done, { once: true });
          });
        })
      : Promise.resolve();

    const audPromise = _audReadyPromise
      ? Promise.race([_audReadyPromise, new Promise(r => setTimeout(r, audTimeoutMs))])
      : Promise.resolve();

    _audReadyPromise = null;
    return Promise.all([imgPromise, audPromise]);
  }

  let _quoteReady = true;
  let _readyToken = 0;   // only the latest quote's wait may start it moving

  // A random quote that isn't the one showing (same index, or same text
  // after the list was swapped for a fresh copy), for every mode, so each
  // switch really shows something new. Counts toward the refetch cycle.
  function pickQuote() {
    let idx = 0;
    if (LOCAL_QUOTES.length > 1) {
      for (let tries = 0; tries < 20; tries++) {
        idx = Math.floor(Math.random() * LOCAL_QUOTES.length);
        if (idx !== lastIdx && LOCAL_QUOTES[idx] !== currentText) break;
      }
    }
    lastIdx = idx;
    seenIndices.add(idx);
    if (seenIndices.size >= LOCAL_QUOTES.length) {
      seenIndices.clear();
      backgroundRefetch();
    }
    return LOCAL_QUOTES[idx];
  }

  const setQuote = () => {
    stopAudio();

    if (pendingQuotes) {
      LOCAL_QUOTES = pendingQuotes;
      pendingQuotes = null;
      seenIndices.clear();
      lastIdx = -1;
    }

    let quoteText;

    if (LOCAL_QUOTES.length === 0) {
      quoteText = "Loading quotes…";
    } else if (currentQtype === "Qrefresh") {
      if (refreshQuote === null) refreshQuote = pickQuote();
      quoteText = refreshQuote;
    } else {
      quoteText = pickQuote();
    }
    currentText = LOCAL_QUOTES.length ? quoteText : null;

    window.WS_QuoteFormat.render(box, quoteText, {
      onAudio: (src, vol, startSec, endSec) => { if (!_audSrc) startAudio(src, vol, startSec, endSec); },
    });
    readCustomSpeeds(box);
    updateSpeed();

    if (currentQtype === "Qrefresh") {
      wrapper.classList.add("qs-mode-refresh");
      box.style.transform = "translateX(0)";
      _readyToken++;
      _quoteReady = true;
      lastTime    = null;
    } else {
      wrapper.classList.remove("qs-mode-refresh");
      if (currentQtype === "Qright") {

        pos = -(box.scrollWidth || box.offsetWidth || 600);
      } else {

        pos = wrapper.offsetWidth;
      }
      box.style.transform = `translateX(${pos}px)`;
      _quoteReady = false;
      // A switch while this quote is still loading replaces it; its late
      // "ready" mustn't set the next quote moving before its own images load.
      const token = ++_readyToken;
      waitForQuoteReady(box).then(() => { if (token === _readyToken) { _quoteReady = true; lastTime = null; } });
    }
  };

  const animate = (time) => {
    if (currentQtype !== "Qrefresh" && _quoteReady && lastTime !== null) {
      if (currentQtype === "Qright") {

        pos += currentSpeed * ((time - lastTime) / 1000);
        box.style.transform = `translateX(${pos}px)`;
        if (pos > wrapper.offsetWidth) { stopAudio(); setQuote(); }
      } else {

        pos -= currentSpeed * ((time - lastTime) / 1000);
        box.style.transform = `translateX(${pos}px)`;
        if (pos + box.offsetWidth < 0) { stopAudio(); setQuote(); }
      }
    }
    lastTime = (_quoteReady && currentQtype !== "Qrefresh") ? time : null;
    requestAnimationFrame(animate);
  };

  wrapper.addEventListener("mouseenter",  () => { isHoveringBox  = true;  updateSpeed(); });
  wrapper.addEventListener("mouseleave",  () => { isHoveringBox  = false; isHoveringText = false; updateSpeed(); });
  box.addEventListener("mouseenter",      () => { isHoveringText = true;  updateSpeed(); });
  box.addEventListener("mouseleave",      () => { isHoveringText = false; updateSpeed(); });
  wrapper.addEventListener("mousedown",   () => { isMouseDown    = true;  updateSpeed(); });
  document.addEventListener("mouseup",    () => { if (!isMouseDown) return; isMouseDown = false; updateSpeed(); });

  document.addEventListener("ws:refetch", () => { if (cacheOn()) backgroundRefetch(true); });

  (async () => {
    let data = null;

    // Saved copy first when the data cache is on.
    if (cacheOn()) data = await window.WS_DataCache.read("quotes");

    if (!parseQuotes(data)) try {
      await ticketReady();
      data = await fetchJSONRetry(() => bustCache(SHEETS_URL));
      if (cacheOn() && parseQuotes(data)) window.WS_DataCache.write("quotes", data);
    } catch (err) {
      console.error("[Quotes] Failed to fetch or parse the quotes sheet response:", err);
      data = null;
    }

    const initial = parseQuotes(data);
    if (!initial) {
      console.error("[Quotes] Sheet responded, but no usable quotes came out of parseQuotes(). Raw response was:", data);
    }
    LOCAL_QUOTES  = initial || ["404 quotes not found."];
    setQuote();
    requestAnimationFrame(animate);
  })();
});