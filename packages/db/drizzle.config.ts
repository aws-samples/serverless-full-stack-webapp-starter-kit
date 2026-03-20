import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  // No dbCredentials — generate is schema-diff only, no DB connection needed.
  // Do not use drizzle-kit push/migrate — DSQL requires 1 DDL per transaction.
  // Use `pnpm run migrate` (custom runner) to apply migrations.
});
