import { AuroraDSQLPool } from '@aws/aurora-dsql-node-postgres-connector';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

let pool: AuroraDSQLPool | undefined;

export function getPool(): AuroraDSQLPool {
  if (!pool) {
    const host = process.env.DSQL_ENDPOINT;
    if (!host) throw new Error('DSQL_ENDPOINT environment variable is required');
    const region = process.env.AWS_REGION;
    if (!region) throw new Error('AWS_REGION environment variable is required');
    pool = new AuroraDSQLPool({ host, region, user: 'admin', database: 'postgres', port: 5432 });
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
