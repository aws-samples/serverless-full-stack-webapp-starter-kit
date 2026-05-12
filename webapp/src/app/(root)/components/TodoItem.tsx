'use client';

import { TodoItem, TodoItemStatus } from '@prisma/client';
import { useState } from 'react';
import { useHookFormAction } from '@next-safe-action/adapter-react-hook-form/hooks';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateTodo, deleteTodo, updateTodoStatus, runTranslateJob } from '../actions';
import { updateTodoSchema } from '../schemas';
import { useAction } from 'next-safe-action/hooks';
import { toast } from 'sonner';
import { Pencil, Trash2, Languages, Calendar, Tag, X, Check } from 'lucide-react';
import PriorityBadge from './PriorityBadge';

interface TodoItemProps {
  todo: TodoItem;
  index?: number;
}

const priorityBorderMap = {
  LOW: 'priority-border-low',
  MEDIUM: 'priority-border-medium',
  HIGH: 'priority-border-high',
  URGENT: 'priority-border-urgent',
};

export default function TodoItemComponent({ todo, index = 0 }: TodoItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const { execute, status: translateStatus } = useAction(runTranslateJob, {
    onSuccess: () => {
      toast.success('Translation job started successfully');
    },
    onError: (error) => {
      toast.error(typeof error === 'string' ? error : 'Failed to start translation job');
    },
  });

  // Update Todo Form Action with React Hook Form
  const {
    form: { register: registerUpdate, formState: updateFormState },
    action: updateAction,
    handleSubmitWithAction: handleUpdate,
  } = useHookFormAction(updateTodo, zodResolver(updateTodoSchema), {
    actionProps: {
      onSuccess: () => {
        toast.success('Todo updated successfully');
        setIsEditing(false);
      },
      onError: ({ error }) => {
        toast.error(typeof error === 'string' ? error : 'Failed to update todo');
      },
    },
    formProps: {
      defaultValues: {
        id: todo.id,
        title: todo.title,
        description: todo.description,
        status: todo.status,
        priority: todo.priority,
        dueDate: todo.dueDate ? new Date(todo.dueDate).toISOString().split('T')[0] : '',
        category: todo.category || '',
      },
    },
  });

  // Delete Todo Action
  const { execute: executeDelete, status: deleteStatus } = useAction(deleteTodo, {
    onSuccess: () => {
      toast.success('Todo deleted successfully');
    },
    onError: (error) => {
      toast.error(typeof error === 'string' ? error : 'Failed to delete todo');
    },
  });

  // Update Status Action
  const { execute: executeStatusUpdate, status: statusStatus } = useAction(updateTodoStatus, {
    onSuccess: () => {
      toast.success('Status updated successfully');
    },
    onError: (error) => {
      toast.error(typeof error === 'string' ? error : 'Failed to update status');
    },
  });

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this todo?')) {
      executeDelete({ id: todo.id });
    }
  };

  const toggleStatus = () => {
    const newStatus = todo.status === TodoItemStatus.PENDING ? TodoItemStatus.COMPLETED : TodoItemStatus.PENDING;
    executeStatusUpdate({
      id: todo.id,
      status: newStatus,
    });
  };

  const isOverdue =
    todo.dueDate &&
    new Date(todo.dueDate) < new Date() &&
    todo.status === TodoItemStatus.PENDING;

  const isActioning =
    deleteStatus === 'executing' || statusStatus === 'executing' || translateStatus === 'executing';

  // ── Edit Mode ──
  if (isEditing) {
    return (
      <div
        className="glass-card rounded-xl p-5 mb-3 animate-scale-in"
      >
        <form onSubmit={handleUpdate} className="space-y-4">
          <input type="hidden" {...registerUpdate('id')} value={todo.id} />
          <input type="hidden" {...registerUpdate('status')} value={todo.status} />

          <div>
            <label className="form-label">Title</label>
            <input
              type="text"
              {...registerUpdate('title')}
              className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm text-zinc-200"
            />
            {updateFormState.errors.title && (
              <p className="mt-1 text-xs text-red-400">{updateFormState.errors.title.message}</p>
            )}
          </div>

          <div>
            <label className="form-label">Description</label>
            <textarea
              {...registerUpdate('description')}
              rows={3}
              className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm text-zinc-200 resize-none"
            />
            {updateFormState.errors.description && (
              <p className="mt-1 text-xs text-red-400">{updateFormState.errors.description.message}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="form-label">Priority</label>
              <select
                {...registerUpdate('priority')}
                className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm text-zinc-200 cursor-pointer"
              >
                <option value="LOW" className="bg-zinc-900">Low</option>
                <option value="MEDIUM" className="bg-zinc-900">Medium</option>
                <option value="HIGH" className="bg-zinc-900">High</option>
                <option value="URGENT" className="bg-zinc-900">Urgent</option>
              </select>
            </div>
            <div>
              <label className="form-label">Due Date</label>
              <input
                type="date"
                {...registerUpdate('dueDate')}
                className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm text-zinc-200 [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="form-label">Category</label>
              <input
                type="text"
                {...registerUpdate('category')}
                placeholder="e.g. Work"
                className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm text-zinc-200"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="btn-ghost inline-flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateAction.isExecuting}
              className="btn-primary inline-flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              {updateAction.isExecuting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ── View Mode ──
  return (
    <div
      className={`glass-card-hover rounded-xl mb-3 overflow-hidden animate-fade-in-up ${
        priorityBorderMap[todo.priority] || 'priority-border-medium'
      } ${isOverdue ? 'overdue-glow' : ''}`}
      style={{ animationDelay: `${index * 0.05}s`, opacity: 0 }}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Checkbox */}
          <input
            type="checkbox"
            checked={todo.status === TodoItemStatus.COMPLETED}
            onChange={toggleStatus}
            disabled={statusStatus === 'executing'}
            className="custom-checkbox mt-0.5"
          />

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3
                className={`font-semibold text-[0.9375rem] leading-snug ${
                  todo.status === TodoItemStatus.COMPLETED
                    ? 'line-through text-zinc-600'
                    : 'text-zinc-200'
                }`}
              >
                {todo.title}
              </h3>
              <PriorityBadge priority={todo.priority} />
            </div>

            <p
              className={`text-sm leading-relaxed mb-2 ${
                todo.status === TodoItemStatus.COMPLETED
                  ? 'line-through text-zinc-700'
                  : 'text-zinc-500'
              }`}
            >
              {todo.description}
            </p>

            {/* Meta row */}
            <div className="flex items-center gap-3 flex-wrap">
              {todo.dueDate && (
                <span
                  className={`inline-flex items-center gap-1 text-[0.6875rem] ${
                    isOverdue ? 'text-red-400' : 'text-zinc-600'
                  }`}
                >
                  <Calendar className="w-3 h-3" />
                  {new Date(todo.dueDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                  {isOverdue && (
                    <span className="text-[0.625rem] text-red-400 font-medium ml-1">OVERDUE</span>
                  )}
                </span>
              )}
              {todo.category && (
                <span className="inline-flex items-center gap-1 text-[0.6875rem] text-zinc-600">
                  <Tag className="w-3 h-3" />
                  {todo.category}
                </span>
              )}
              <span className="text-[0.6875rem] text-zinc-700">
                {new Date(todo.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={() => setIsEditing(true)}
              disabled={isActioning}
              className="btn-icon"
              title="Edit"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => execute({ id: todo.id })}
              disabled={isActioning}
              className="btn-icon"
              title="Translate"
            >
              <Languages className="w-4 h-4" />
            </button>
            <button
              onClick={handleDelete}
              disabled={isActioning}
              className="btn-danger"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
