const test = require('node:test');
const assert = require('node:assert');
const { londonParts, minutesToHHMM } = require('./londonTime');

test('BST (UTC+1): late evening UTC is already the next hour in London', () => {
  const p = londonParts(new Date('2026-09-18T22:30:00Z'));
  assert.deepStrictEqual([p.date, p.time], ['2026-09-18', '23:30']);
});

test('BST: 23:30 UTC rolls into the next London day', () => {
  const p = londonParts(new Date('2026-09-18T23:30:00Z'));
  assert.deepStrictEqual([p.date, p.time], ['2026-09-19', '00:30']);
});

test('GMT after clocks go back on 25 Oct 2026: offset is zero', () => {
  const p = londonParts(new Date('2026-10-26T00:30:00Z'));
  assert.deepStrictEqual([p.date, p.time], ['2026-10-26', '00:30']);
});

test('still BST just before the switch at 01:00 UTC on 25 Oct 2026', () => {
  const p = londonParts(new Date('2026-10-25T00:30:00Z'));
  assert.deepStrictEqual([p.date, p.time], ['2026-10-25', '01:30']);
});

test('spring forward on 29 Mar 2026: 01:30 UTC is 02:30 London', () => {
  const p = londonParts(new Date('2026-03-29T01:30:00Z'));
  assert.deepStrictEqual([p.date, p.time], ['2026-03-29', '02:30']);
});

test('midnight is 00:xx, never 24:xx', () => {
  const p = londonParts(new Date('2026-01-15T00:05:00Z'));
  assert.strictEqual(p.time, '00:05');
});

test('minutesToHHMM clamps to the day', () => {
  assert.strictEqual(minutesToHHMM(-5), '00:00');
  assert.strictEqual(minutesToHHMM(9 * 60 + 5), '09:05');
  assert.strictEqual(minutesToHHMM(24 * 60 + 30), '23:59');
});
