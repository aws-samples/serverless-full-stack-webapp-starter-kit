CREATE TABLE IF NOT EXISTS "User" (
  "id" text PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS "TodoItem" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "description" text NOT NULL,
  "userId" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC IF NOT EXISTS "TodoItem_userId_createdAt_idx" ON "TodoItem" ("userId", "createdAt");
