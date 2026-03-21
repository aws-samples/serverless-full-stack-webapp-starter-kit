CREATE TABLE IF NOT EXISTS "Comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"content" text NOT NULL,
	"userId" text NOT NULL REFERENCES "User"("id"),
	"createdAt" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "Comment_userId_idx" ON "Comment" ("userId");--> statement-breakpoint
ALTER TABLE "TodoItem" ADD COLUMN "priority" text;
