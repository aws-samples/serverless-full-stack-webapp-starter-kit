CREATE INDEX ASYNC "TodoItem_status_idx" ON "TodoItem" ("status");

CREATE UNIQUE INDEX ASYNC "TodoItem_title_userId_idx" ON "TodoItem" ("title", "userId");
