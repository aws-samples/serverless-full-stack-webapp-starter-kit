'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useHookFormAction } from '@next-safe-action/adapter-react-hook-form/hooks';
import { createTodo } from '../actions';
import { createTodoSchema } from '../schemas';
import { toast } from 'sonner';
import { useEventBus } from '@/hooks/use-event-bus';
import { useRouter } from 'next/navigation';

export default function CreateTodoForm(props: { userId: string }) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const router = useRouter();

  useEventBus({
    channelName: `user/${props.userId}/jobs`,
    onReceived: (data) => {
      console.log('received', data);
      router.refresh();
    },
  });

  const {
    form: { register, formState, reset },
    action,
    handleSubmitWithAction,
  } = useHookFormAction(createTodo, zodResolver(createTodoSchema), {
    actionProps: {
      onSuccess: () => {
        toast.success('Todo created successfully');
        reset();
        setIsFormOpen(false);
      },
      onError: ({ error }) => {
        toast.error(typeof error === 'string' ? error : 'Failed to create todo');
      },
    },
    formProps: {
      defaultValues: {
        title: '',
        description: '',
      },
    },
  });

  if (!isFormOpen) {
    return (
      <div className="mb-6">
        <button
          onClick={() => setIsFormOpen(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          + Add New Todo
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white shadow-md rounded-lg p-6 mb-6">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Create New Todo</h2>
      <form onSubmit={handleSubmitWithAction} className="space-y-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700">
            Title
          </label>
          <input
            id="title"
            {...register('title')}
            placeholder="Your TODO item title."
            className="mt-1 p-2 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
          {formState.errors.title && <p className="mt-1 text-sm text-red-600">{formState.errors.title.message}</p>}
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="description"
            {...register('description')}
            rows={3}
            placeholder="Describe your TODO item."
            className="mt-1 p-2 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
          {formState.errors.description && (
            <p className="mt-1 text-sm text-red-600">{formState.errors.description.message}</p>
          )}
        </div>

        <div className="flex justify-end space-x-2">
          <button
            type="button"
            onClick={() => setIsFormOpen(false)}
            className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-gray-700 bg-gray-200 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={action.isExecuting}
            className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            {action.isExecuting ? 'Creating...' : 'Create Todo'}
          </button>
        </div>
      </form>
    </div>
  );
}
