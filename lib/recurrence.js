// Next occurrence of a recurring task, as a YYYY-MM-DD string.
//
// Steps forward from the ORIGINAL due date (so a weekly task stays on its
// weekday and a monthly one on its day-of-month) until the result is after
// today. Completing a task that's overdue therefore schedules the next one in
// the future instead of handing back another already-overdue task.
// All arithmetic is on calendar dates via UTC, so DST can't shift a day.

function split(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

function iso(dt) {
  return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
}

function addDays(dateStr, n) {
  const { y, m, d } = split(dateStr);
  return iso(new Date(Date.UTC(y, m - 1, d + n)));
}

// Clamp to the target month's last day, but always measure from the original
// day-of-month so Jan 31 -> Feb 28 -> Mar 31 rather than drifting to the 28th.
function addMonths(dateStr, n) {
  const { y, m, d } = split(dateStr);
  const total = (m - 1) + n;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(ny, nm, Math.min(d, last))));
}

const STEPS = {
  daily: (due, k) => addDays(due, k),
  weekly: (due, k) => addDays(due, 7 * k),
  monthly: (due, k) => addMonths(due, k)
};

function nextOccurrence(dueDate, recurring, today) {
  const step = STEPS[recurring];
  if (!step || !dueDate) return null;
  let k = 1;
  let candidate = step(dueDate, k);
  while (candidate <= today && k < 20000) candidate = step(dueDate, ++k);
  return candidate;
}

module.exports = { nextOccurrence };
