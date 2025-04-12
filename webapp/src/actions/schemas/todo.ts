import { z } from 'zod';
import { TodoItemStatus } from '@prisma/client';

export const createTodoSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
});

export const updateTodoSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  status: z.nativeEnum(TodoItemStatus),
});

export const deleteTodoSchema = z.object({
  id: z.string().uuid(),
});

export const updateTodoStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.nativeEnum(TodoItemStatus),
});
