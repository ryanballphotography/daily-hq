const test = require('node:test');
const assert = require('node:assert');
const { dueSoonTasks, clampLead } = require('./reminderWindow');

const task = (overrides) => ({ id: 1, title: 'x', time_block: '11:00', reminder_lead: 30, ...overrides });
const ids = rows => rows.map(t => t.id);

test('within its own lead window: included', () => {
  // due 11:00, now 10:50 -> 10 min out, lead 30 -> included
  assert.deepStrictEqual(ids(dueSoonTasks([task({ id: 1 })], 10 * 60 + 50)), [1]);
});

test('outside its own lead window: excluded (the whole point of per-task leads)', () => {
  // due 11:00, now 10:00 -> 60 min out, lead 30 -> not yet
  assert.deepStrictEqual(dueSoonTasks([task({ id: 1 })], 10 * 60), []);
});

test('exactly at the lead boundary is included (<=)', () => {
  assert.deepStrictEqual(ids(dueSoonTasks([task({ id: 1, reminder_lead: 30 })], 10 * 60 + 30)), [1]);
});

test('one minute past the boundary is excluded', () => {
  assert.deepStrictEqual(dueSoonTasks([task({ id: 1, reminder_lead: 30 })], 10 * 60 + 29), []);
});

test('reminder_lead 0 ("at time only") never gets an advance ping, even one minute out', () => {
  assert.deepStrictEqual(dueSoonTasks([task({ id: 1, reminder_lead: 0, time_block: '11:00' })], 10 * 60 + 59), []);
});

test('reminder_lead null (pre-migration rows) defaults to 30, matching old behaviour', () => {
  assert.deepStrictEqual(ids(dueSoonTasks([task({ id: 1, reminder_lead: null })], 10 * 60 + 50)), [1]);
});

test('a short lead (10 min) correctly excludes a task that a 30-min default would have caught', () => {
  // due 11:00, now 10:35 -> 25 min out. lead 10 -> not yet; lead 30 -> would be included.
  assert.deepStrictEqual(dueSoonTasks([task({ id: 1, reminder_lead: 10 })], 10 * 60 + 35), []);
  assert.deepStrictEqual(ids(dueSoonTasks([task({ id: 1, reminder_lead: 30 })], 10 * 60 + 35)), [1]);
});

test('already-due or overdue tasks are excluded — that is the overdue check\'s job, not this one', () => {
  assert.deepStrictEqual(dueSoonTasks([task({ id: 1, time_block: '11:00' })], 11 * 60), []); // exactly due
  assert.deepStrictEqual(dueSoonTasks([task({ id: 1, time_block: '11:00' })], 11 * 60 + 5), []); // overdue
});

test('malformed time_block is excluded rather than throwing', () => {
  assert.deepStrictEqual(dueSoonTasks([task({ id: 1, time_block: null })], 10 * 60), []);
  assert.deepStrictEqual(dueSoonTasks([task({ id: 1, time_block: 'garbage' })], 10 * 60), []);
});

test('clampLead: valid values pass through as integers', () => {
  assert.strictEqual(clampLead(0), 0);
  assert.strictEqual(clampLead(10), 10);
  assert.strictEqual(clampLead('20'), 20); // form values arrive as strings
  assert.strictEqual(clampLead(15.6), 16); // rounds
});

test('clampLead: missing/empty defaults to 30, not 0 — so a bare "0" is never confused with "not provided"', () => {
  assert.strictEqual(clampLead(undefined), 30);
  assert.strictEqual(clampLead(null), 30);
  assert.strictEqual(clampLead(''), 30);
});

test('clampLead: garbage and out-of-range values are rejected, not stored as NaN or absurd numbers', () => {
  assert.strictEqual(clampLead('not a number'), 30);
  assert.strictEqual(clampLead(NaN), 30);
  assert.strictEqual(clampLead(-50), 0);          // clamped to the floor
  assert.strictEqual(clampLead(999999), 24 * 60);  // clamped to one day
});

test('mixed batch: each task judged by its own lead, independently', () => {
  const rows = [
    task({ id: 1, time_block: '11:00', reminder_lead: 10 }),  // 20 min out, lead 10 -> no
    task({ id: 2, time_block: '11:10', reminder_lead: 30 }),  // 30 min out, lead 30 -> yes
    task({ id: 3, time_block: '11:00', reminder_lead: 0 }),   // at-time only -> no
    task({ id: 4, time_block: '10:45', reminder_lead: 15 }),  // 5 min out, lead 15 -> yes
  ];
  assert.deepStrictEqual(ids(dueSoonTasks(rows, 10 * 60 + 40)).sort(), [2, 4]);
});
