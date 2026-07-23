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

export const createTodo = authActionClient.schema(createTodoSchema).action(async ({ parsedInput, ctx }) => {
  const { title, description } = parsedInput;
  const { userId } = ctx;

  const [todo] = await db.insert(todoItems).values({ title, description, userId, status: 'PENDING' }).returning();

  revalidatePath('/');
  return { todo };
});

export const updateTodo = authActionClient.schema(updateTodoSchema).action(async ({ parsedInput, ctx }) => {
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

export const deleteTodo = authActionClient.schema(deleteTodoSchema).action(async ({ parsedInput, ctx }) => {
  const { id } = parsedInput;
  const { userId } = ctx;

  await db.delete(todoItems).where(and(eq(todoItems.id, id), eq(todoItems.userId, userId)));

  revalidatePath('/');
  return { success: true };
});

export const updateTodoStatus = authActionClient.schema(updateTodoStatusSchema).action(async ({ parsedInput, ctx }) => {
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

export const runTranslateJob = authActionClient.schema(runTranslateJobSchema).action(async ({ parsedInput, ctx }) => {
  const { id } = parsedInput;
  const { userId } = ctx;
  await runJob({
    type: 'translate',
    todoItemId: id,
    userId: userId,
  });
});
