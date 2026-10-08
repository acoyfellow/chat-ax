import { describe, expect, test } from 'bun:test';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { createStorageConformance } from '@earendil-works/pi-durable/testing';
import { durableObjectSqliteDatabase } from './do-sqlite-database';
import { durableObjectStorageStandIn } from './test-storage';

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const partial = (actual: any, expected: any): boolean =>
  expected === null || typeof expected !== 'object'
    ? same(actual, expected)
    : Object.keys(expected).every((key) => partial(actual?.[key], expected[key]));

describe('pi-durable storage on Durable Object SQLite', () => {
  test('passes the pi-durable storage conformance suite', async () => {
    const cases = createStorageConformance({
      assertions: {
        ok: (value, message) => expect(Boolean(value), message).toBe(true),
        strictEqual: (actual, expected) => expect(actual).toBe(expected),
        deepEqual: (actual, expected) => expect(actual).toEqual(expected),
        partialDeepEqual: (actual, expected) => expect(partial(actual, expected)).toBe(true),
        greaterThan: (actual, expected) => expect(actual).toBeGreaterThan(expected),
        rejects: async (operation, includes) => {
          await expect(operation).rejects.toThrow(includes);
        },
      },
      withStorage: async (use) => use(await SqliteStorage.open(durableObjectSqliteDatabase(durableObjectStorageStandIn()))),
    });
    expect(cases.length).toBeGreaterThan(20);
    for (const testCase of cases) await testCase.run();
  });

  test('never issues SQL transaction statements', async () => {
    const storage = durableObjectStorageStandIn();
    const database = durableObjectSqliteDatabase(storage);
    await database.exec('CREATE TABLE t (v INTEGER)');
    await expect(
      database.transaction(async (tx) => {
        await tx.run('INSERT INTO t VALUES (?)', 1);
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(await database.all('SELECT v FROM t')).toEqual([]);
  });
});
