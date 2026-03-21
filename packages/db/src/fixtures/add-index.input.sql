CREATE INDEX "TodoItem_status_idx" ON "TodoItem" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "TodoItem_title_userId_idx" ON "TodoItem" ("title", "userId");
