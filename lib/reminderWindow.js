const { hhmmToMinutes } = require('./londonTime');

// Validates a reminder_lead value coming from a request body before it
// reaches the database: reject garbage (NaN, negative, absurdly large)
// rather than let it poison the reminder-window arithmetic. Missing/empty
// falls back to 30, the old hardcoded value, so untouched clients (Siri,
// the email scanner, quick-add) keep today's behaviour.
function clampLead(v) {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) return 30;
  return Math.min(Math.max(Math.round(n), 0), 24 * 60);
}

// Which of these tasks (already filtered to: not done, due today, has a
// time, not recently reminded) should get their advance "due soon" push
// right now — per the task's OWN reminder_lead (minutes before time_block)
// rather than one fixed window for every task.
//
// reminder_lead of 0 means "no advance ping, only once it's actually due" —
// those are deliberately excluded here; checkReminders' separate overdue
// check still covers them once time_block has passed. null/undefined (rows
// from before this was configurable) defaults to 30, the old hardcoded value.
function dueSoonTasks(rows, nowMinutes) {
  return rows.filter(t => {
    const due = hhmmToMinutes(t.time_block);
    if (due === null) return false;
    const lead = t.reminder_lead == null ? 30 : t.reminder_lead;
    if (lead <= 0) return false;
    return due > nowMinutes && due - nowMinutes <= lead;
  });
}

module.exports = { dueSoonTasks, clampLead };
