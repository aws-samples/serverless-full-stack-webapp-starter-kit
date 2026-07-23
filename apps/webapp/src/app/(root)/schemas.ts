import { z } from 'zod';

export const TodoItemStatus = { PENDING: 'PENDING', COMPLETED: 'COMPLETED' } as const;
export type TodoItemStatus = (typeof TodoItemStatus)[keyof typeof TodoItemStatus];
const todoItemStatusSchema = z.enum(['PENDING', 'COMPLETED']);

export const createTodoSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
});

export const updateTodoSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  status: todoItemStatusSchema,
});

export const deleteTodoSchema = z.object({
  id: z.uuid(),
});

export const updateTodoStatusSchema = z.object({
  id: z.uuid(),
  status: todoItemStatusSchema,
});

export const runTranslateJobSchema = z.object({
  id: z.uuid(),
});
