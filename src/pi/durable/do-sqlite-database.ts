import type { SqliteDatabase, SqliteExecutor, SqliteValue } from '@earendil-works/pi-durable/storage/sqlite';

export type SqlStorage = {
  sql: { exec(query: string, ...bindings: unknown[]): { toArray(): unknown[] } };
  transaction<T>(closure: () => Promise<T>): Promise<T>;
};

function isRow<T extends object>(value: unknown): value is T {
  return typeof value === 'object' && value !== null;
}

function rows<T extends object>(storage: SqlStorage, sql: string, params: SqliteValue[]): T[] {
  return storage.sql.exec(sql, ...params).toArray().filter((row): row is T => isRow<T>(row));
}

function executor(storage: SqlStorage): SqliteExecutor {
  return {
    async exec(sql) {
      storage.sql.exec(sql);
    },
    async run(sql, ...params) {
      storage.sql.exec(sql, ...params);
    },
    async get<T extends object>(sql: string, ...params: SqliteValue[]) {
      return rows<T>(storage, sql, params)[0];
    },
    async all<T extends object>(sql: string, ...params: SqliteValue[]) {
      return rows<T>(storage, sql, params);
    },
  };
}

export function durableObjectSqliteDatabase(storage: SqlStorage): SqliteDatabase {
  const direct = executor(storage);
  let tail: Promise<unknown> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation, operation);
    tail = next.catch(() => undefined);
    return next;
  };
  return {
    exec: (sql) => serialized(() => direct.exec(sql)),
    run: (sql, ...params) => serialized(() => direct.run(sql, ...params)),
    get: (sql, ...params) => serialized(() => direct.get(sql, ...params)),
    all: (sql, ...params) => serialized(() => direct.all(sql, ...params)),
    transaction: (callback) => serialized(() => storage.transaction(() => callback(direct))),
    close: async () => undefined,
  };
}
