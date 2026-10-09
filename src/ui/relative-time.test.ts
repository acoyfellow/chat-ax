import { expect, test } from 'bun:test';
import { relativeTime } from './relative-time';

const now = Date.parse('2026-10-09T12:00:00.000Z');
const ago = (seconds: number) => new Date(now - seconds * 1_000).toISOString();

test('relative handoff times stay short and readable', () => {
  expect(relativeTime(ago(3), now)).toBe('just now');
  expect(relativeTime(ago(42), now)).toBe('42s ago');
  expect(relativeTime(ago(32 * 60), now)).toBe('32m ago');
  expect(relativeTime(ago(5 * 3600), now)).toBe('5h ago');
  expect(relativeTime(ago(32239 * 60), now)).toBe('22d ago');
  expect(relativeTime(ago(90 * 86400), now)).toBe('Jul 11');
  expect(relativeTime(new Date(now + 5_000).toISOString(), now)).toBe('just now');
});
