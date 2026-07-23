import type { Handler } from 'aws-lambda';
import path from 'node:path';
import { migrate } from '@repo/db/migrate';
import { getPool } from '@repo/db/client';

/**
 * CloudFormation caps a Custom Resource's `Reason` field at 4096 bytes. When the
 * CDK Trigger provider forwards a thrown error unchanged, a long stack trace or
 * a multi-line migration error can exceed the cap and CFN swallows the real cause,
 * reporting only "Response object is too long." Keep the CFN-facing message short
 * and put the full detail in CloudWatch Logs (which has no length limit).
 */
const MAX_CFN_REASON_LENGTH = 1024;

export const handler: Handler = async () => {
  const pool = getPool();
  try {
    await migrate({
      pool,
      migrationsDir: path.join(process.env.LAMBDA_TASK_ROOT ?? '.', 'migrations'),
      context: { region: process.env.AWS_REGION },
    });
    return { statusCode: 200, body: 'Migration complete' };
  } catch (err) {
    // Full stack goes to CloudWatch — no length constraint here.
    console.error('Migration failed:', err instanceof Error ? (err.stack ?? err.message) : String(err));

    // CFN gets a bounded summary. Most migration errors put a useful headline
    // on the first line (e.g. `error: ... at file:///var/task/handler.mjs`),
    // so prefer that but truncate hard if it's still too long.
    const raw = err instanceof Error ? err.message : String(err);
    const firstLine = raw.split('\n')[0];
    const brief =
      firstLine.length > MAX_CFN_REASON_LENGTH ? `${firstLine.slice(0, MAX_CFN_REASON_LENGTH)}…` : firstLine;
    throw Object.assign(new Error(`Migration failed: ${brief} (see CloudWatch Logs for full stack trace)`), {
      cause: err,
    });
  } finally {
    await pool.end();
  }
};
