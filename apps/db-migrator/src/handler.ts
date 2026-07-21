import type { Handler } from 'aws-lambda';
import { migrate } from '@repo/db/migrate';
import { getPool } from '@repo/db/client';
import path from 'node:path';

export const handler: Handler = async () => {
  const pool = getPool();
  try {
    await migrate({
      pool,
      migrationsDir: path.join(process.env.LAMBDA_TASK_ROOT ?? '.', 'migrations'),
      context: { region: process.env.AWS_REGION },
    });
    return { statusCode: 200, body: 'Migration complete' };
  } finally {
    await pool.end();
  }
};
