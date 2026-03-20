import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

let pool: AuroraDSQLPool | undefined;

export function getPool(): AuroraDSQLPool {
  if (!pool) {
    pool = new AuroraDSQLPool({
      host: process.env.DSQL_ENDPOINT!,
      region: process.env.AWS_REGION!,
      user: 'admin',
      database: 'postgres',
      port: 5432,
    });
  }
  return pool;
}

type DbInstance = ReturnType<typeof drizzle<typeof schema>>;

// Lazy singleton for hot-reload safety.
// Uses a Proxy so `import { db }` works without triggering pool creation at module load.
const globalForDb = globalThis as unknown as { _db: DbInstance };

export const db: DbInstance = new Proxy({} as DbInstance, {
  get(_target, prop, receiver) {
    if (!globalForDb._db) {
      globalForDb._db = drizzle({ client: getPool(), schema });
    }
    return Reflect.get(globalForDb._db, prop, receiver);
  },
});
