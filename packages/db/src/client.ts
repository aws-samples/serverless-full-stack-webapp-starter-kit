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

// Singleton for hot-reload safety
const globalForDb = globalThis as unknown as { db: ReturnType<typeof createDb> };

function createDb() {
  return drizzle({ client: getPool(), schema });
}

export const db = globalForDb.db ?? createDb();

if (process.env.NODE_ENV !== 'production') {
  globalForDb.db = db;
}
