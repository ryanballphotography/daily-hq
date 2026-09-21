const test = require('node:test');
const assert = require('node:assert');
const { nextOccurrence } = require('./recurrence');

test('weekly, completed on the day: +7', () => {
  assert.strictEqual(nextOccurrence('2026-09-14', 'weekly', '2026-09-14'), '2026-09-21');
});

test('weekly, 12 days overdue: next occurrence is in the future, same weekday', () => {
  // 6 Sept + 7n -> 13, 20. Completing on the 18th must give the 20th, not the 13th.
  assert.strictEqual(nextOccurrence('2026-09-06', 'weekly', '2026-09-18'), '2026-09-20');
});

test('weekly, completed early: just +7 from the due date', () => {
  assert.strictEqual(nextOccurrence('2026-09-25', 'weekly', '2026-09-18'), '2026-10-02');
});

test('a task due today and completed today does not come back today', () => {
  assert.strictEqual(nextOccurrence('2026-09-18', 'daily', '2026-09-18'), '2026-09-19');
});

test('daily, several days overdue: tomorrow', () => {
  assert.strictEqual(nextOccurrence('2026-09-10', 'daily', '2026-09-18'), '2026-09-19');
});

test('monthly clamps to month end without drifting', () => {
  assert.strictEqual(nextOccurrence('2026-01-31', 'monthly', '2026-01-31'), '2026-02-28');
  // Late by a month: goes back to the 31st, not stuck on the 28th.
  assert.strictEqual(nextOccurrence('2026-01-31', 'monthly', '2026-03-01'), '2026-03-31');
});

test('monthly handles leap years and year rollover', () => {
  assert.strictEqual(nextOccurrence('2028-01-31', 'monthly', '2028-01-31'), '2028-02-29');
  assert.strictEqual(nextOccurrence('2026-12-15', 'monthly', '2026-12-15'), '2027-01-15');
});

test('accepts a full ISO timestamp for the due date', () => {
  assert.strictEqual(nextOccurrence('2026-09-14T00:00:00.000Z', 'weekly', '2026-09-14'), '2026-09-21');
});

test('unknown or missing recurrence returns null', () => {
  assert.strictEqual(nextOccurrence('2026-09-14', 'yearly', '2026-09-14'), null);
  assert.strictEqual(nextOccurrence(null, 'weekly', '2026-09-14'), null);
});
