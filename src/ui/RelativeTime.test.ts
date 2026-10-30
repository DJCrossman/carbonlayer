import { describe, expect, it } from 'vitest';
import { ageOf } from './RelativeTime';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const now = Date.parse('2026-10-30T12:00:00Z');

describe("a compact age, as Graphite's inbox and stack rows count it", () => {
  it.each([
    ['23h59m', '23h', 23 * hour + 59 * minute],
    ['24h', '1d', 24 * hour],
    ['35h', '1d', 35 * hour],
    ['36h', '2d', 36 * hour],
    ['47h', '2d', 47 * hour],
    ['8.7d', '9d', 8.7 * day],
    ['29d', '29d', 29 * day],
    ['30d', '1mo', 30 * day],
    ['52d', '2mo', 52 * day],
    ['114d', '4mo', 114 * day],
    ['400d', '1y', 400 * day],
  ])('%s old reads %s', (_, expected, age) => {
    expect(ageOf(now - age, now, false)).toBe(expected);
  });
});
