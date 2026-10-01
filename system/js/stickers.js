"use strict";

// ── Stickers ───────────────────────────────────────────────────────────
// Every sticker lives at mediabaseWS stickers/<pack>/<file>. This list is
// shared by the quote box (quotes.js), the pop-ups that slap a random
// sticker on their corner (daily picks, shortcuts, tutorial) and the
// sticker picker tool (tools/stickers.html).
//
// In a quote, write a sticker as :<pack>/<file>: (for example
// :MeltGui-pack/airluv.webp:) or by its short name, :airluv:. Either form
// is matched without caring about upper/lower case.
//
// Adding a sticker: drop the file in its pack folder and add a line here
// (short name → "pack/file"). Short names must be unique across packs.
(() => {
  window.stickerManifest = {
    "airluv": "MeltGui-pack/airluv.webp",
    "angel": "MeltGui-pack/angel.webp",
    "angry": "MeltGui-pack/angry.gif",
    "bahh": "MeltGui-pack/bahh.gif",
    "bleh": "MeltGui-pack/bleh.webp",
    "call": "MeltGui-pack/call.webp",
    "cheer": "MeltGui-pack/cheer.webp",
    "collapse": "MeltGui-pack/collapse.webp",
    "confusion": "MeltGui-pack/confusion.webp",
    "cryin": "MeltGui-pack/cryin.webp",
    "doc": "MeltGui-pack/doc.webp",
    "exhausted": "MeltGui-pack/exhausted.webp",
    "furypunch": "MeltGui-pack/furypunch.webp",
    "ghoul": "MeltGui-pack/ghoul.webp",
    "grossedout": "MeltGui-pack/grossedout.webp",
    "laughing": "MeltGui-pack/laughing.gif",
    "lucky": "MeltGui-pack/lucky.webp",
    "luv": "MeltGui-pack/luv.webp",
    "melon": "MeltGui-pack/melon.webp",
    "noodle": "MeltGui-pack/noodle.webp",
    "palleta": "MeltGui-pack/palleta.webp",
    "shambala": "MeltGui-pack/shambala.webp",
    "singing": "MeltGui-pack/singing.webp",
    "tea": "MeltGui-pack/tea.webp",
    "tease": "MeltGui-pack/tease.webp",
    "tired": "MeltGui-pack/tired.webp",
    "tsundere": "MeltGui-pack/tsundere.webp",
    "vamphour": "MeltGui-pack/vamphour.webp",
    "vibingout": "MeltGui-pack/vibingout.webp",
    "walkin": "MeltGui-pack/walkin.webp",
    "bochiwork": "bocci-pack/bochiwork.jpg",
    "chikatworl": "chika-pack/chikaTworl.gif",
    "chikagree": "chika-pack/chikagree.gif",
    "chikflush": "chika-pack/chikflush.gif",
    "pinkdance": "chika-pack/pinkDance.gif",
    "akairodance": "deFlockaWeen-pack/akairoDance.gif",
    "boomstickcat": "deFlockaWeen-pack/boomstickcat.gif",
    "ghomp": "deFlockaWeen-pack/ghomp.gif",
    "ghooost": "deFlockaWeen-pack/ghooost.gif",
    "hankmy": "deFlockaWeen-pack/hankmy.gif",
    "pumpkat": "deFlockaWeen-pack/pumpkat.jpg",
    "sneekkawlshie": "deFlockaWeen-pack/sneekKawlshie.gif",
    "succarage": "deFlockaWeen-pack/succaRage.gif",
    "booo": "halloween-pack/booo.gif",
    "burninskele": "halloween-pack/burninskele.gif",
    "happyhallow": "halloween-pack/happyHallow.gif",
    "pumpkin": "halloween-pack/pumpkin.gif",
    "punkinsglowy": "halloween-pack/punkinsglowy.gif",
    "luckypen": "luckyStar-pack/luckypen.jpg",
    "nomestare": "nome-pack/nomestare.jpg",
    "nomework": "nome-pack/nomework.gif",
    "satanichiarage": "satanichia-pack/SatanichiaRage.jpg",
    "satanichiagree": "satanichia-pack/Satanichiagree.jpg",
    "scarletcryin": "scarlet-pack/scarletCryin.jpg",
    "scarleteat": "scarlet-pack/scarletEat.jpg",
  };

  // Stickers live in the mediabaseWS repo (endpoints.js), so this is the same
  // absolute URL from every page.
  window.stickerBasePath = "https://raw.githubusercontent.com/wannasmile4evr/mediabaseWS/main/stickers/";

  // Lower-cased "pack/file", "pack/name" and "name" → the real "pack/file".
  const lookup = new Map();
  for (const [name, path] of Object.entries(window.stickerManifest)) {
    lookup.set(name.toLowerCase(), path);
    lookup.set(path.toLowerCase(), path);
    lookup.set(path.replace(/\.[^./]+$/, "").toLowerCase(), path);
  }

  // A sticker reference (what's between the colons) → its image URL, or
  // null if it isn't one. A "pack/file.ext" that isn't in the list is still
  // tried as-is, so a newly added file works before it's listed here.
  function src(ref) {
    ref = String(ref || "").trim();
    if (!ref || ref.includes("..") || !/^[\w\-\/.]+$/.test(ref)) return null;
    const path = lookup.get(ref.toLowerCase())
      || (/^[\w\-]+\/[\w\-]+\.(png|gif|webp|jpe?g)$/i.test(ref) ? ref : null);
    return path ? window.stickerBasePath + path : null;
  }

  // [{ pack, name, file, path, code }] in pack order, for the picker.
  function list() {
    return Object.entries(window.stickerManifest).map(([name, path]) => {
      const [pack, file] = path.split("/");
      return { pack, name, file, path, code: `:${path}:` };
    });
  }

  window.WS_Stickers = { src, list };
})();
