'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useHookFormAction } from '@next-safe-action/adapter-react-hook-form/hooks';
import { createTodo } from '../actions';
import { createTodoSchema } from '../schemas';
import { toast } from 'sonner';
import { useEventBus } from '@/hooks/use-event-bus';
import { useRouter } from 'next/navigation';
import { Plus, X, Sparkles, ArrowDown, Minus, AlertTriangle, Flame } from 'lucide-react';

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
    form: { register, formState, reset, setValue, watch },
    action,
    handleSubmitWithAction,
  } = useHookFormAction(createTodo, zodResolver(createTodoSchema), {
    actionProps: {
      onSuccess: () => {
        toast.success('Task created successfully');
        reset();
        setIsFormOpen(false);
      },
      onError: ({ error }) => {
        toast.error(typeof error === 'string' ? error : 'Failed to create task');
      },
    },
    formProps: {
      defaultValues: {
        title: '',
        description: '',
        priority: 'MEDIUM',
        dueDate: '',
        category: '',
      },
    },
  });

  const selectedPriority = watch('priority');

  const priorities = [
    { value: 'LOW', label: 'Low', icon: ArrowDown, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', activeBg: 'bg-emerald-500/20' },
    { value: 'MEDIUM', label: 'Med', icon: Minus, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', activeBg: 'bg-amber-500/20' },
    { value: 'HIGH', label: 'High', icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30', activeBg: 'bg-orange-500/20' },
    { value: 'URGENT', label: 'Urgent', icon: Flame, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', activeBg: 'bg-red-500/20' },
  ];

  if (!isFormOpen) {
    return (
      <div className="mb-6">
        <button
          onClick={() => setIsFormOpen(true)}
          className="group inline-flex items-center gap-2.5 btn-primary py-2.5 px-5 text-sm"
        >
          <div className="w-5 h-5 rounded-md bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-colors">
            <Plus className="w-3.5 h-3.5 text-white" />
          </div>
          Add New Task
        </button>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-6 mb-6 animate-scale-in">
      <div className="flex items-center gap-2 mb-5">
        <Sparkles className="w-5 h-5 text-violet-400" />
        <h2 className="text-lg font-semibold text-zinc-200">Create New Task</h2>
      </div>

      <form onSubmit={handleSubmitWithAction} className="space-y-4">
        {/* Title */}
        <div>
          <label htmlFor="title" className="form-label">
            Title
          </label>
          <input
            id="title"
            {...register('title')}
            placeholder="What needs to be done?"
            className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm text-zinc-200 placeholder-zinc-600"
          />
          {formState.errors.title && (
            <p className="mt-1 text-xs text-red-400">{formState.errors.title.message}</p>
          )}
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="form-label">
            Description
          </label>
          <textarea
            id="description"
            {...register('description')}
            rows={3}
            placeholder="Add some details..."
            className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm text-zinc-200 placeholder-zinc-600 resize-none"
          />
          {formState.errors.description && (
            <p className="mt-1 text-xs text-red-400">{formState.errors.description.message}</p>
          )}
        </div>

        {/* Priority Selector */}
        <div>
          <label className="form-label">Priority</label>
          <div className="flex gap-2">
            {priorities.map((p) => {
              const Icon = p.icon;
              const isActive = selectedPriority === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setValue('priority', p.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all duration-200 ${
                    isActive
                      ? `${p.activeBg} ${p.color} ${p.border}`
                      : 'bg-transparent text-zinc-500 border-white/[0.06] hover:border-white/[0.12]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Due Date & Category Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="dueDate" className="form-label">
              Due Date
            </label>
            <input
              id="dueDate"
              type="date"
              {...register('dueDate')}
              className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm text-zinc-200 [color-scheme:dark]"
            />
          </div>
          <div>
            <label htmlFor="category" className="form-label">
              Category
            </label>
            <input
              id="category"
              type="text"
              {...register('category')}
              placeholder="e.g. Work, Personal"
              className="w-full px-3.5 py-2.5 rounded-xl glass-input text-sm text-zinc-200 placeholder-zinc-600"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              setIsFormOpen(false);
              reset();
            }}
            className="btn-ghost inline-flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
          <button
            type="submit"
            disabled={action.isExecuting}
            className="btn-primary inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {action.isExecuting ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </form>
    </div>
  );
}
