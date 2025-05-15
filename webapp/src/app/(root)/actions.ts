'use server';

import { authActionClient } from '@/lib/safe-action';
import {
  createTodoSchema,
  deleteTodoSchema,
  runTranslateJobSchema,
  updateTodoSchema,
  updateTodoStatusSchema,
} from './schemas';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { TodoItemStatus } from '@prisma/client';
import { runJob } from '@/lib/jobs';

export const createTodo = authActionClient.schema(createTodoSchema).action(async ({ parsedInput, ctx }) => {
  const { title, description } = parsedInput;
  const { userId } = ctx;

  const todo = await prisma.todoItem.create({
    data: {
      title,
      description,
      userId,
      status: TodoItemStatus.PENDING,
    },
  });

  revalidatePath('/');
  return { todo };
});

export const updateTodo = authActionClient.schema(updateTodoSchema).action(async ({ parsedInput, ctx }) => {
  const { id, title, description, status } = parsedInput;
  const { userId } = ctx;

  const todo = await prisma.todoItem.update({
    where: {
      id,
      userId,
    },
    data: {
      title,
      description,
      status,
    },
  });

  revalidatePath('/');
  return { todo };
});

export const deleteTodo = authActionClient.schema(deleteTodoSchema).action(async ({ parsedInput, ctx }) => {
  const { id } = parsedInput;
  const { userId } = ctx;

  await prisma.todoItem.delete({
    where: {
      id,
      userId,
    },
  });

  revalidatePath('/');
  return { success: true };
});

export const updateTodoStatus = authActionClient.schema(updateTodoStatusSchema).action(async ({ parsedInput, ctx }) => {
  const { id, status } = parsedInput;
  const { userId } = ctx;

  const todo = await prisma.todoItem.update({
    where: {
      id,
      userId,
    },
    data: {
      status,
    },
  });

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
