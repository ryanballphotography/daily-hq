// Pulls a start time out of a calendar event title like
// "Kids swimming 830-930" or "Exhibition at Wells Cathedral 1830".
//
// Used for events that are all-day in the calendar but have the real time
// typed into the title — there's no structured start time to use, and without
// this they never get placed on the timeline. Deliberately conservative:
// it returns null rather than guess, and skips times introduced by
// "till"/"until"/"pickup" etc., which are end times, not starts.
//
// Shared between Node (tests) and the browser (<script>), like parseTask.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.extractTitleTime = factory().extractTitleTime;
})(typeof self !== 'undefined' ? self : this, function () {

  const ATOM = '\\d{1,2}(?:[.:]\\d{2})?\\s*(?:am|pm)?|\\d{3,4}';
  const RE = new RegExp('(' + ATOM + ')(?:\\s*[-\u2013]\\s*(' + ATOM + '))?(?![\\w:/]|[.:]\\d)', 'gi');
  // A time can't be glued to these — prices, dates, ids, "Wk2".
  const BAD_BEFORE = /[\w£$#.:/]/;
  // "till 1630", "pickup 1610" — these name an end time, not when it starts.
  const END_WORD = /\b(?:till|until|til|by|to|pickup|pick-up|pick up|ends?|finish(?:es)?|before)\s*$/i;

  function parseAtom(raw) {
    const s = raw.trim().toLowerCase();
    const mer = /(am|pm)$/.exec(s);
    const digits = s.replace(/\s*(am|pm)$/, '');
    let h, m, real;
    if (/^\d{3,4}$/.test(digits)) {
      h = Number(digits.slice(0, -2));
      m = Number(digits.slice(-2));
      real = true;
      // 1900–2099 is far more likely a year than a time, unless it lands on
      // a quarter hour ("2030" is 8:30pm, "2026" is not a time).
      if (digits.length === 4 && /^(19|20)/.test(digits) && m % 15 !== 0) return null;
    } else if (/^\d{1,2}[.:]\d{2}$/.test(digits)) {
      const parts = digits.split(/[.:]/);
      h = Number(parts[0]); m = Number(parts[1]);
      real = true;
    } else if (/^\d{1,2}$/.test(digits)) {
      h = Number(digits); m = 0;
      real = Boolean(mer); // a bare "10" only counts as part of a range
    } else return null;
    if (m > 59) return null;
    return { h, m, mer: mer ? mer[1] : null, real };
  }

  // Resolve 12h/24h. Without am/pm: 13+ is 24h, 8–11 is morning, 12 is noon,
  // 1–7 is afternoon/evening (a 3.30 kick-off is 15:30, not 03:30).
  function to24(a, mer) {
    let h = a.h;
    if (mer) {
      if (h < 1 || h > 12) return null;
      if (mer === 'am') return h === 12 ? 0 : h;
      return h === 12 ? 12 : h + 12;
    }
    if (h > 23) return null;
    if (h >= 1 && h <= 7) return h + 12;
    return h;
  }

  const hhmm = (h, m) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');

  function extractTitleTime(title) {
    if (!title) return null;
    RE.lastIndex = 0;
    let match;
    while ((match = RE.exec(title))) {
      const before = title.slice(0, match.index);
      if (match.index > 0 && BAD_BEFORE.test(before[before.length - 1])) continue;
      if (END_WORD.test(before)) continue;

      const a = parseAtom(match[1]);
      const b = match[2] ? parseAtom(match[2]) : null;
      if (!a) continue;
      if (!a.real && !(b && b.real)) continue;

      let aMer = a.mer;
      if (b && !aMer && b.mer && a.h >= 1 && a.h <= 12) {
        // "7-8pm" is 7pm–8pm, "11-1pm" is 11am–1pm.
        aMer = (a.h % 12) <= (b.h % 12) ? b.mer : (b.mer === 'pm' ? 'am' : 'pm');
      }
      const startH = to24(a, aMer);
      if (startH === null) continue;
      let end = null;
      if (b) {
        const endH = to24(b, b.mer);
        if (endH !== null) end = hhmm(endH, b.m);
      }
      return { start: hhmm(startH, a.m), end };
    }
    return null;
  }

  return { extractTitleTime };
});
