"use strict";

// QRWS is fetched only on demand so the ticket gate has already settled.
(() => {
  const CACHE_KEY = "ws_qr_cache";
  const NS = "http://www.w3.org/2000/svg";
  let overlay = null;
  let urls = [];
  let codes = [];
  let selected = 0;
  let statusTimer = 0;
  let removeTimer = 0;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function cleanURLs(values) {
    const seen = new Set();
    return values.reduce((result, value) => {
      if (typeof value !== "string") return result;
      const url = value.replace(/^'/, "").trim();
      if (!url || url.length > 500 || seen.has(url)) return result;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return result;
      } catch (_) { return result; }
      seen.add(url);
      if (result.length < 12) result.push(url);
      return result;
    }, []);
  }

  function buildCodes(list) {
    return list.map((url) => {
      try { return { url, svg: qrSVG(url), error: false }; }
      catch (_) { return { url, svg: null, error: true }; }
    });
  }

  function readCache() {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
      return Array.isArray(value) ? cleanURLs(value) : [];
    } catch (_) { return []; }
  }

  function saveCache(list) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch (_) {}
  }

  function setStatus(message) {
    const status = overlay?.querySelector(".rf-status");
    if (status) status.textContent = message;
  }

  function reveal(current) {
    if (overlay !== current || !current.isConnected) return;
    const panel = current.querySelector(".rf-panel");
    if (!panel || !panel.hidden) return;
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      if (overlay !== current) return;
      current.classList.add("is-ready");
      current.querySelector(".rf-close")?.focus({ preventScroll: true });
    });
  }

  async function copyURL(url) {
    const current = overlay;
    const input = current?.querySelector(".rf-url");
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch (_) {}
    if (!copied && input) {
      input.focus({ preventScroll: true });
      input.select();
      try { copied = document.execCommand("copy"); } catch (_) {}
    }
    if (overlay === current) setStatus(copied ? "Copied!" : "Copy failed. Select the URL and copy it.");
    if (copied && typeof window.showToast === "function") window.showToast("Copied!");
    clearTimeout(statusTimer);
    if (copied) statusTimer = setTimeout(() => {
      if (overlay === current) setStatus("");
    }, 1500);
  }

  function downloadQR() {
    const current = overlay;
    const code = codes[selected];
    if (!current || !code || code.error) return;

    const svgText = new XMLSerializer().serializeToString(code.svg);
    const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const svgURL = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(svgURL);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1024;
      const context = canvas.getContext("2d");
      if (!context) { if (overlay === current) setStatus("Could not prepare the QR image."); return; }
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) { if (overlay === current) setStatus("Could not create the QR image."); return; }
        const pngURL = URL.createObjectURL(blob);
        const link = el("a");
        link.href = pngURL;
        link.download = "wannasmile-qr.png";
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(pngURL), 1000);
        if (overlay === current) setStatus("QR image downloaded.");
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => {
          if (overlay === current) setStatus("");
        }, 1800);
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(svgURL);
      if (overlay === current) setStatus("Could not prepare the QR image.");
    };
    image.src = svgURL;
  }

  function qrSVG(url) {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const count = qr.getModuleCount();
    const size = count + 8;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `QR code for ${url}`);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("focusable", "false");
    const background = document.createElementNS(NS, "rect");
    background.setAttribute("width", String(size));
    background.setAttribute("height", String(size));
    background.setAttribute("fill", "#fff");
    const path = document.createElementNS(NS, "path");
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
      }
    }
    path.setAttribute("d", d);
    path.setAttribute("fill", "#000");
    svg.append(background, path);
    svg.addEventListener("click", (event) => {
      if (event.shiftKey) {
        event.preventDefault();
        void copyURL(url);
      }
    });
    return svg;
  }

  function paint() {
    const content = overlay.querySelector(".rf-content");
    const nav = overlay.querySelector(".rf-nav");
    const status = overlay.querySelector(".rf-status");
    const input = overlay.querySelector(".rf-url");
    const copy = overlay.querySelector(".rf-copy");
    const download = overlay.querySelector(".rf-download");
    content.replaceChildren();
    nav.hidden = urls.length < 2;
    if (!urls.length) {
      input.value = "";
      copy.disabled = true;
      download.disabled = true;
      status.textContent = "No link to share right now.";
      content.append(el("p", "rf-state", "No link to share right now."));
      return;
    }

    const code = codes[selected];
    input.value = code.url;
    copy.disabled = false;
    download.disabled = code.error;
    status.textContent = "";
    if (code.error) {
      content.append(el("p", "rf-state rf-state-error", "That link is too long for a QR code."));
    } else {
      const card = el("div", "rf-qr-card");
      card.title = "Shift-click to copy this URL";
      card.append(code.svg);
      content.append(card);
    }
    overlay.querySelector(".rf-counter").textContent = `${selected + 1} / ${urls.length}`;
  }

  function focusables() {
    return [...overlay.querySelectorAll("button:not([disabled]), input:not([disabled])")]
      .filter((node) => !node.hidden && !node.closest("[hidden]"));
  }

  function close() {
    if (!overlay) return;
    const current = overlay;
    overlay = null;
    current.removeEventListener("keydown", onKey, true);
    current.classList.remove("is-open");
    clearTimeout(removeTimer);
    removeTimer = setTimeout(() => current.remove(), 180);
    clearTimeout(statusTimer);
    document.getElementById("dashboardBtn")?.focus({ preventScroll: true });
  }

  function onKey(event) {
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = focusables();
    if (!controls.length) {
      event.preventDefault();
      overlay?.focus({ preventScroll: true });
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function load() {
    const current = overlay;
    if (!current) return;
    const content = current.querySelector(".rf-content");
    const status = current.querySelector(".rf-status");
    const retry = current.querySelector(".rf-retry");
    content.replaceChildren(el("p", "rf-state", "Making your QR code…"));
    current.querySelector(".rf-nav").hidden = true;
    current.querySelector(".rf-url").value = "";
    current.querySelector(".rf-copy").disabled = true;
    current.querySelector(".rf-download").disabled = true;
    status.textContent = "Making your QR code…";
    retry.hidden = true;
    try {
      await window.WS_Ticket?.ready;
      if (overlay !== current) return;
      if (window.WS_Ticket && !window.WS_Ticket.approved()) throw new Error("Ticket is not approved.");
      const base = window.WS_ENDPOINTS?.data;
      if (!base || typeof window.bustCache !== "function") throw new Error("QR feed is unavailable.");
      const response = await fetch(window.bustCache(`${base}?type=qr`), { cache: "no-store" });
      if (overlay !== current) return;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (!json || json.error) throw new Error(json?.error || "QR feed is unavailable.");
      const list = cleanURLs(Object.values(json).find(Array.isArray) || []);
      urls = list;
      codes = buildCodes(list);
      saveCache(list);
      selected = list.length ? Math.floor(Math.random() * list.length) : 0;
      paint();
    } catch (_) {
      if (overlay !== current) return;
      const cached = readCache();
      if (cached.length) {
        urls = cached;
        codes = buildCodes(cached);
        selected = Math.floor(Math.random() * cached.length);
        paint();
        status.textContent = "Showing saved links; the live list could not be loaded.";
      } else {
        urls = [];
        codes = [];
        content.replaceChildren(el("p", "rf-state rf-state-error", "Couldn't load the link. Try again."));
        status.textContent = "Couldn't load the link. Try again.";
        retry.hidden = false;
      }
    } finally {
      reveal(current);
    }
  }

  function iconButton(className, label, iconName) {
    const button = el("button", className);
    button.type = "button";
    button.setAttribute("aria-label", label);
    const icon = el("i", `fa-solid ${iconName}`);
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
    return button;
  }

  function open() {
    if (overlay) {
      if (overlay.isConnected && !overlay.querySelector(".rf-panel")?.hidden) {
        overlay.querySelector(".rf-close")?.focus({ preventScroll: true });
      }
      return;
    }
    clearTimeout(removeTimer);
    document.getElementById("wsRefer")?.remove();
    const menu = document.getElementById("dashboardMenu");
    if (menu?.style.display === "block") document.getElementById("dashboardBtn")?.click();

    overlay = el("div", "rf-overlay");
    overlay.id = "wsRefer";
    overlay.tabIndex = -1;
    const current = overlay;
    const panel = el("section", "rf-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "rfTitle");
    panel.setAttribute("aria-hidden", "true");
    panel.hidden = true;
    panel.tabIndex = -1;

    const head = el("div", "rf-head");
    const title = el("h2", "rf-title", "Refer a friend");
    title.id = "rfTitle";
    const closeButton = iconButton("rf-close", "Close refer a friend", "fa-xmark");
    closeButton.title = "Close";
    head.append(title, closeButton);

    const content = el("div", "rf-content");
    const urlRow = el("div", "rf-url-row");
    const input = el("input", "rf-url");
    input.type = "text";
    input.readOnly = true;
    input.id = "rfShareURL";
    input.setAttribute("aria-label", "Share URL");
    input.addEventListener("focus", () => input.select());
    input.addEventListener("click", () => input.select());
    const share = el("div", "rf-share");
    const actions = el("div", "rf-actions");
    const copy = el("button", "rf-button rf-copy");
    copy.type = "button";
    const copyIcon = el("i", "fa-solid fa-copy");
    copyIcon.setAttribute("aria-hidden", "true");
    copy.append(copyIcon, document.createTextNode("Copy link"));
    const download = el("button", "rf-button rf-download");
    download.type = "button";
    download.disabled = true;
    const downloadIcon = el("i", "fa-solid fa-download");
    downloadIcon.setAttribute("aria-hidden", "true");
    download.append(downloadIcon, document.createTextNode("Download QR"));
    actions.append(copy, download);
    urlRow.append(input);
    share.append(urlRow, actions);

    const nav = el("div", "rf-nav");
    const prev = iconButton("rf-arrow", "Previous QR code", "fa-chevron-left");
    const counter = el("span", "rf-counter");
    counter.setAttribute("aria-live", "polite");
    const next = iconButton("rf-arrow", "Next QR code", "fa-chevron-right");
    nav.append(prev, counter, next);

    const status = el("p", "rf-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const retry = el("button", "rf-button rf-retry", "Retry");
    retry.type = "button";
    retry.hidden = true;

    panel.append(head, content, nav, share, status, retry);
    overlay.append(panel);
    document.body.append(overlay);
    overlay.addEventListener("keydown", onKey, true);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
    closeButton.addEventListener("click", close);
    copy.addEventListener("click", () => { if (urls[selected]) void copyURL(urls[selected]); });
    download.addEventListener("click", downloadQR);
    retry.addEventListener("click", () => { void load(); });
    requestAnimationFrame(() => {
      if (overlay !== current) return;
      current.classList.add("is-open");
      current.focus({ preventScroll: true });
    });
    prev.addEventListener("click", () => {
      selected = (selected - 1 + urls.length) % urls.length;
      paint();
    });
    next.addEventListener("click", () => {
      selected = (selected + 1) % urls.length;
      paint();
    });
    void load();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("openRefer")?.addEventListener("click", (event) => {
      event.preventDefault();
      open();
    });
  });

  window.WSRefer = { open, close };
})();