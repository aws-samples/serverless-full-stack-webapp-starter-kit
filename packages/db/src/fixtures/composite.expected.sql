CREATE TABLE IF NOT EXISTS "Comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"content" text NOT NULL,
	"userId" text NOT NULL,
	"createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ASYNC "Comment_userId_idx" ON "Comment" ("userId");

ALTER TABLE "TodoItem" ADD COLUMN "priority" text;
