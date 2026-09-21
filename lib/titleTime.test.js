const test = require('node:test');
const assert = require('node:assert');
const { extractTitleTime } = require('./titleTime');

const start = t => (extractTitleTime(t) || {}).start ?? null;

// Real titles from the calendar feed.
test('compact 24h: "…Wells Cathedral 1830"', () => {
  assert.strictEqual(start('Somerset Partnership Murmuration Project exhibition at Wells Cathedral 1830'), '18:30');
});

test('compact range: "Kids swimming 830-930"', () => {
  assert.deepStrictEqual(extractTitleTime('Kids swimming 830-930'), { start: '08:30', end: '09:30' });
});

test('bare hour start of a range: "Elliott football 10-1130"', () => {
  assert.deepStrictEqual(extractTitleTime('Elliott football 10-1130'), { start: '10:00', end: '11:30' });
});

test('24h range: "Elora - drama barn 1140-1310"', () => {
  assert.deepStrictEqual(extractTitleTime('Elora - drama barn 1140-1310'), { start: '11:40', end: '13:10' });
});

test('single compact: "Childcare 1730" and "Elora speech&drama 1040"', () => {
  assert.strictEqual(start('Childcare 1730'), '17:30');
  assert.strictEqual(start('Elora speech&drama 1040'), '10:40');
});

test('am/pm: "MDT Voy Tessa - 7.30pm"', () => {
  assert.strictEqual(start('MDT Voy Tessa - 7.30pm'), '19:30');
});

test('afternoon heuristic for 1–7 without am/pm: "Cleaner 1.30-4.30"', () => {
  assert.deepStrictEqual(extractTitleTime('Cleaner 1.30-4.30'), { start: '13:30', end: '16:30' });
});

test('start inherits the meridiem of the end: "7-8pm", "11-1pm"', () => {
  assert.deepStrictEqual(extractTitleTime('Childcare 7 – 8pm'), { start: '19:00', end: '20:00' });
  assert.deepStrictEqual(extractTitleTime('Lunch 11-1pm'), { start: '11:00', end: '13:00' });
});

test('"piano 445 18 ash grove": takes 4:45pm, not the house number', () => {
  assert.strictEqual(start('Elora - piano 445 18 ash grove'), '16:45');
});

// Things that must NOT be read as a start time.
test('end times are skipped: "Childcare till 1630 - pickup 1610"', () => {
  assert.strictEqual(extractTitleTime('Childcare till 1630 - pickup 1610'), null);
});

test('no time at all', () => {
  assert.strictEqual(extractTitleTime('Owen / Hattie visiting'), null);
  assert.strictEqual(extractTitleTime('Tessa working Voy'), null);
  assert.strictEqual(extractTitleTime(''), null);
  assert.strictEqual(extractTitleTime(null), null);
});

test('fractions, codes and counts are not times', () => {
  assert.strictEqual(extractTitleTime('Wk2 Lidl GB Christmas POS (Day 1/3)'), null);
  assert.strictEqual(extractTitleTime('Wk3 Lidl GB Christmas POS (Day 2/3)'), null);
  assert.strictEqual(extractTitleTime('Book 12 tables'), null);
});

test('prices and years are not times', () => {
  assert.strictEqual(extractTitleTime('Pay £12.50 for kit'), null);
  assert.strictEqual(extractTitleTime('Renew licence 2026'), null);
  assert.strictEqual(extractTitleTime('Shoot 1930s diner'), null);
});

test('a year-shaped number on a quarter hour is still a time: "Gig 2030"', () => {
  assert.strictEqual(start('Gig 2030'), '20:30');
});

test('impossible times are rejected', () => {
  assert.strictEqual(extractTitleTime('Room 2575'), null);
  assert.strictEqual(extractTitleTime('Unit 999'), null);
});
