import { Database } from 'bun:sqlite';
import type { SqlStorage } from './do-sqlite-database';

export function durableObjectStorageStandIn() {
  const database = new Database(':memory:');
  let depth = 0;
  const sql = {
    exec(query: string, ...params: unknown[]) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(query))
        throw new Error('Durable Objects reject SQL transaction statements; use storage.transaction()');
      const statements = params.length === 0 ? query.split(/;\s*(?=\S)/) : [query];
      let result: unknown[] = [];
      for (const statement of statements) {
        const prepared = database.prepare(statement);
        result = prepared.all(...(params as never[]));
      }
      return { toArray: () => result };
    },
  };
  return {
    sql,
    async transaction<T>(closure: () => Promise<T>): Promise<T> {
      const name = `sp${depth++}`;
      database.run(`SAVEPOINT ${name}`);
      try {
        const value = await closure();
        database.run(`RELEASE ${name}`);
        return value;
      } catch (error) {
        database.run(`ROLLBACK TO ${name}`);
        database.run(`RELEASE ${name}`);
        throw error;
      } finally {
        depth -= 1;
      }
    },
  } satisfies SqlStorage;
}
