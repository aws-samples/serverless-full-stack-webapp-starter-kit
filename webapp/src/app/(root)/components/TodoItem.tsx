'use client';

import { TodoItem, TodoItemStatus } from '@prisma/client';
import { useState } from 'react';
import { useHookFormAction } from '@next-safe-action/adapter-react-hook-form/hooks';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateTodo, deleteTodo, updateTodoStatus, runTranslateJob } from '../actions';
import { updateTodoSchema } from '../schemas';
import { useAction } from 'next-safe-action/hooks';
import { toast } from 'sonner';

interface TodoItemProps {
  todo: TodoItem;
}

export default function TodoItemComponent({ todo }: TodoItemProps) {
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
      },
    },
  });

  // Delete Todo Action - Simple action without form
  const { execute: executeDelete, status: deleteStatus } = useAction(deleteTodo, {
    onSuccess: () => {
      toast.success('Todo deleted successfully');
    },
    onError: (error) => {
      toast.error(typeof error === 'string' ? error : 'Failed to delete todo');
    },
  });

  // Update Status Action - Simple action without form
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

  if (isEditing) {
    return (
      <div className="border p-4 rounded-md shadow-sm mb-4 bg-white">
        <form onSubmit={handleUpdate} className="space-y-4">
          <input type="hidden" {...registerUpdate('id')} value={todo.id} />
          <input type="hidden" {...registerUpdate('status')} value={todo.status} />

          <div>
            <label className="block text-sm font-medium text-gray-700">Title</label>
            <input
              type="text"
              {...registerUpdate('title')}
              className="mt-1 p-2 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
            {updateFormState.errors.title && (
              <p className="mt-1 text-sm text-red-600">{updateFormState.errors.title.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              {...registerUpdate('description')}
              rows={3}
              className="mt-1 p-2 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
            {updateFormState.errors.description && (
              <p className="mt-1 text-sm text-red-600">{updateFormState.errors.description.message}</p>
            )}
          </div>

          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-gray-700 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateAction.isExecuting}
              className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              {updateAction.isExecuting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div
      className={`border p-4 rounded-md shadow-sm mb-4 ${todo.status === TodoItemStatus.COMPLETED ? 'bg-gray-50' : 'bg-white'}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center">
          <input
            type="checkbox"
            checked={todo.status === TodoItemStatus.COMPLETED}
            onChange={toggleStatus}
            disabled={statusStatus === 'executing'}
            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
          />
          <div className="ml-3">
            <h3
              className={`text-lg font-medium ${todo.status === TodoItemStatus.COMPLETED ? 'line-through text-gray-500' : 'text-gray-900'}`}
            >
              {todo.title}
            </h3>
            <p
              className={`text-sm ${todo.status === TodoItemStatus.COMPLETED ? 'line-through text-gray-400' : 'text-gray-600'}`}
            >
              {todo.description}
            </p>
            <p className="text-xs text-gray-400 mt-1">Created: {new Date(todo.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => setIsEditing(true)}
            disabled={deleteStatus === 'executing' || statusStatus === 'executing' || translateStatus === 'executing'}
            className="text-indigo-600 hover:text-indigo-900 disabled:opacity-50"
          >
            Edit
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteStatus === 'executing' || statusStatus === 'executing' || translateStatus === 'executing'}
            className="text-red-600 hover:text-red-900 disabled:opacity-50"
          >
            {deleteStatus === 'executing' ? 'Deleting...' : 'Delete'}
          </button>
          <button
            onClick={() => execute({ id: todo.id })}
            disabled={deleteStatus === 'executing' || statusStatus === 'executing' || translateStatus === 'executing'}
            className="text-green-600 hover:text-green-900 disabled:opacity-50"
          >
            {translateStatus === 'executing' ? 'Translating...' : 'Translate'}
          </button>
        </div>
      </div>
    </div>
  );
}
