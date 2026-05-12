import { z } from 'zod';
import TodoItemStatusSchema from '@/lib/generated/prisma/zod/inputTypeSchemas/TodoItemStatusSchema';

// Priority enum validation (matches Prisma TodoItemPriority)
const TodoItemPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

export const createTodoSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  priority: TodoItemPrioritySchema,
  dueDate: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
});

export const updateTodoSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  status: TodoItemStatusSchema,
  priority: TodoItemPrioritySchema.optional(),
  dueDate: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
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
