import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './client';
import { migrate } from './migrate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const pool = getPool();
  try {
    await migrate({ pool, migrationsDir: path.join(__dirname, '..', 'migrations') });
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
