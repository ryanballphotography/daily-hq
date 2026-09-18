const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTask } = require('./parseTask');

// Thursday 17 Sep 2026, 09:00 — fixed reference date for deterministic tests.
const REF = new Date('2026-09-17T09:00:00');

test('time-only contact-free: "Meeting with Sam @10am today"', () => {
  const r = parseTask('Meeting with Sam @10am today', REF);
  assert.equal(r.title, 'Meeting with Sam');
  assert.equal(r.contact, null);
  assert.equal(r.hasTime, true);
  assert.equal(r.dueAt.toISOString().slice(0, 16), '2026-09-17T09:00');
  assert.equal(r.project, null);
  assert.equal(r.priority, 1);
  assert.equal(r.raw, 'Meeting with Sam @10am today');
});

test('double-bang priority: "Call Graziella next Tuesday !!"', () => {
  const r = parseTask('Call Graziella next Tuesday !!', REF);
  assert.equal(r.title, 'Call Graziella');
  assert.equal(r.priority, 3);
  assert.equal(r.hasTime, false);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getDay(), 2); // Tuesday
});

test('project tag with date and time: "Invoice Lidl IE #admin Friday 3pm"', () => {
  const r = parseTask('Invoice Lidl IE #admin Friday 3pm', REF);
  assert.equal(r.title, 'Invoice Lidl IE');
  assert.equal(r.project, 'admin');
  assert.equal(r.hasTime, true);
  assert.equal(r.dueAt.getHours(), 15);
});

test('no date, no time: "Order gels"', () => {
  const r = parseTask('Order gels', REF);
  assert.equal(r.title, 'Order gels');
  assert.equal(r.dueAt, null);
  assert.equal(r.hasTime, false);
  assert.equal(r.project, null);
  assert.equal(r.contact, null);
  assert.equal(r.priority, 1);
});

test('contact and date, no time: "lunch @Tessa tomorrow"', () => {
  const r = parseTask('lunch @Tessa tomorrow', REF);
  assert.equal(r.title, 'lunch');
  assert.equal(r.contact, 'Tessa');
  assert.equal(r.hasTime, false);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.toDateString(), new Date('2026-09-18T09:00:00').toDateString());
});

test('relative range: "submit selects in 2 weeks"', () => {
  const r = parseTask('submit selects in 2 weeks', REF);
  assert.equal(r.title, 'submit selects');
  assert.equal(r.hasTime, false);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.toDateString(), new Date('2026-10-01T09:00:00').toDateString());
});

test('single-bang priority', () => {
  const r = parseTask('Order gels !', REF);
  assert.equal(r.title, 'Order gels');
  assert.equal(r.priority, 2);
});

test('unparseable / no strippable content falls back to raw text as title', () => {
  const r = parseTask('!!', REF);
  assert.equal(r.title, '!!');
  assert.equal(r.priority, 3);
  assert.equal(r.raw, '!!');
});

test('UK day/month numeric convention: 3/4 means 3 April, not March 4', () => {
  const r = parseTask('renew licence 3/4', REF);
  assert.ok(r.dueAt);
  assert.equal(r.dueAt.getDate(), 3);
  assert.equal(r.dueAt.getMonth(), 3); // April (0-indexed)
});

test('never throws on garbage input', () => {
  assert.doesNotThrow(() => parseTask('', REF));
  assert.doesNotThrow(() => parseTask('   ', REF));
  assert.doesNotThrow(() => parseTask('#@!!! @@@ ###', REF));
});
