import { z } from 'zod';
import TodoItemStatusSchema from '@/lib/generated/prisma/zod/inputTypeSchemas/TodoItemStatusSchema';

export const createTodoSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
});

export const updateTodoSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  status: TodoItemStatusSchema,
});

export const deleteTodoSchema = z.object({
  id: z.string().uuid(),
});

export const updateTodoStatusSchema = z.object({
  id: z.string().uuid(),
  status: TodoItemStatusSchema,
});

export const runTranslateJobSchema = z.object({
  id: z.string().uuid(),
});
