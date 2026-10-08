import { describe, expect, test } from 'bun:test';
import { expiringRecordKeysToDelete } from './expiring-records';

describe('operational retry record retention', () => {
  test('expires records after their retry window', () => {
    expect(
      expiringRecordKeysToDelete(
        [
          ['expired', { expiresAt: 100 }],
          ['live', { expiresAt: 101 }],
        ],
        100,
        10,
      ),
    ).toEqual(['expired']);
  });

  test('caps live records in storage order', () => {
    const records = Array.from(
      { length: 5 },
      (_, index) => [`record-${index}`, { expiresAt: 1_000 }] as const,
    );
    expect(expiringRecordKeysToDelete(records, 100, 3)).toEqual(['record-0', 'record-1']);
  });
});
