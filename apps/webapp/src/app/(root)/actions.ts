'use server';

import { authActionClient } from '@/lib/safe-action';
import {
  createTodoSchema,
  deleteTodoSchema,
  runTranslateJobSchema,
  updateTodoSchema,
  updateTodoStatusSchema,
} from './schemas';
import { db } from '@repo/db/client';
import { todoItems } from '@repo/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { runJob } from '@/lib/jobs';

export const createTodo = authActionClient.inputSchema(createTodoSchema).action(async ({ parsedInput, ctx }) => {
  const { title, description } = parsedInput;
  const { userId } = ctx;

  const [todo] = await db.insert(todoItems).values({ title, description, userId, status: 'PENDING' }).returning();

  revalidatePath('/');
  return { todo };
});

export const updateTodo = authActionClient.inputSchema(updateTodoSchema).action(async ({ parsedInput, ctx }) => {
  const { id, title, description, status } = parsedInput;
  const { userId } = ctx;

  const [todo] = await db
    .update(todoItems)
    .set({ title, description, status, updatedAt: new Date() })
    .where(and(eq(todoItems.id, id), eq(todoItems.userId, userId)))
    .returning();

  revalidatePath('/');
  return { todo };
});

export const deleteTodo = authActionClient.inputSchema(deleteTodoSchema).action(async ({ parsedInput, ctx }) => {
  const { id } = parsedInput;
  const { userId } = ctx;

  await db.delete(todoItems).where(and(eq(todoItems.id, id), eq(todoItems.userId, userId)));

  revalidatePath('/');
  return { success: true };
});

export const updateTodoStatus = authActionClient
  .inputSchema(updateTodoStatusSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { id, status } = parsedInput;
    const { userId } = ctx;

    const [todo] = await db
      .update(todoItems)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(todoItems.id, id), eq(todoItems.userId, userId)))
      .returning();

    revalidatePath('/');
    return { todo };
  });

export const runTranslateJob = authActionClient
  .inputSchema(runTranslateJobSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { id } = parsedInput;
    const { userId } = ctx;
    await runJob({
      type: 'translate',
      todoItemId: id,
      userId: userId,
    });
  });
