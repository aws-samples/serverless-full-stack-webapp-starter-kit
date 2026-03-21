CREATE TABLE IF NOT EXISTS "Comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"content" text NOT NULL,
	"userId" text NOT NULL REFERENCES "User"("id"),
	"todoId" uuid NOT NULL REFERENCES "TodoItem"("id"),
	"createdAt" timestamptz NOT NULL DEFAULT now()
);
