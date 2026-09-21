// Wall-clock date/time in Europe/London for any instant, correct across the
// GMT/BST switch. Uses Intl with an explicit zone so it doesn't depend on the
// host's TZ setting or on a hardcoded UTC offset.
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23'
});

function londonParts(instant = new Date()) {
  const p = {};
  for (const { type, value } of fmt.formatToParts(instant)) p[type] = value;
  return {
    date: p.year + '-' + p.month + '-' + p.day,
    time: p.hour + ':' + p.minute,
    minutes: Number(p.hour) * 60 + Number(p.minute)
  };
}

function minutesToHHMM(total) {
  const m = Math.min(Math.max(total, 0), 23 * 60 + 59);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

module.exports = { londonParts, minutesToHHMM };
