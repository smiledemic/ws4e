"use strict";

// ── Version info + date parser ─────────────────────────────────────────
// version.json at the site root holds author / title / description /
// version / date. `date` is empty until a release is stamped and is written
// as MMDDYY. Slashes are optional when it is read: "101026" and "10/10/26"
// both mean 10 October 2026 (MMDDYYYY / MM/DD/YYYY work too).
//
//   WS_Version.parseDate("101026")   -> { month, day, year, compact: "101026", slashed: "10/10/26", iso: "2026-10-10", date: Date }
//   WS_Version.parseDate("10/10/26") -> same object
//   WS_Version.parseDate("")         -> null  (also null for anything invalid)
//   WS_Version.load()                -> Promise of version.json with `parsed` added
(() => {
  const pad = (n) => String(n).padStart(2, "0");

  function parseDate(input) {
    const raw = String(input == null ? "" : input).trim();
    if (!raw) return null;
    let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(raw);
    if (!m) {
      const d = /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(raw);   // no slashes: MMDDYY(YY)
      m = d;
    }
    if (!m) return null;
    const month = +m[1], day = +m[2];
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    const yy = pad(year % 100);
    return {
      month, day, year,
      compact: pad(month) + pad(day) + yy,
      slashed: pad(month) + "/" + pad(day) + "/" + yy,
      iso: year + "-" + pad(month) + "-" + pad(day),
      date,
    };
  }

  let cache = null;
  function load() {
    if (!cache) {
      cache = fetch("version.json", { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("version.json " + r.status))))
        .then((v) => Object.assign({}, v, { parsed: parseDate(v && v.date) }))
        .catch(() => null);
    }
    return cache;
  }

  window.WS_Version = { parseDate, load };
})();
