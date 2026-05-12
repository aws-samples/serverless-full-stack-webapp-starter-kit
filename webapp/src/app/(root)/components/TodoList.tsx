'use client';

import { TodoItem } from '@prisma/client';
import { useState, useMemo } from 'react';
import TodoItemComponent from './TodoItem';
import SearchFilter, { StatusFilter, PriorityFilter } from './SearchFilter';
import DashboardStats from './DashboardStats';
import EmptyState from './EmptyState';
import { Inbox, CheckCircle2, Search } from 'lucide-react';

interface TodoListProps {
  todos: TodoItem[];
  userId: string;
}

export default function TodoList({ todos }: TodoListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('ALL');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Extract unique categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    todos.forEach((todo) => {
      if (todo.category) cats.add(todo.category);
    });
    return Array.from(cats).sort();
  }, [todos]);

  // Compute stats
  const stats = useMemo(() => {
    const now = new Date();
    return {
      total: todos.length,
      pending: todos.filter((t) => t.status === 'PENDING').length,
      completed: todos.filter((t) => t.status === 'COMPLETED').length,
      overdue: todos.filter(
        (t) => t.dueDate && new Date(t.dueDate) < now && t.status === 'PENDING'
      ).length,
    };
  }, [todos]);

  // Filter todos
  const filteredTodos = useMemo(() => {
    return todos.filter((todo) => {
      // Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !todo.title.toLowerCase().includes(q) &&
          !todo.description.toLowerCase().includes(q) &&
          !(todo.category && todo.category.toLowerCase().includes(q))
        ) {
          return false;
        }
      }

      // Status filter
      if (statusFilter !== 'ALL' && todo.status !== statusFilter) {
        return false;
      }

      // Priority filter
      if (priorityFilter !== 'ALL' && todo.priority !== priorityFilter) {
        return false;
      }

      // Category filter
      if (categoryFilter && todo.category !== categoryFilter) {
        return false;
      }

      return true;
    });
  }, [todos, searchQuery, statusFilter, priorityFilter, categoryFilter]);

  const pendingTodos = filteredTodos.filter((t) => t.status === 'PENDING');
  const completedTodos = filteredTodos.filter((t) => t.status === 'COMPLETED');

  const hasActiveFilters = searchQuery || statusFilter !== 'ALL' || priorityFilter !== 'ALL' || categoryFilter;

  return (
    <>
      {/* Stats */}
      <DashboardStats
        total={stats.total}
        pending={stats.pending}
        completed={stats.completed}
        overdue={stats.overdue}
      />

      {/* Search & Filters */}
      <SearchFilter
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        priorityFilter={priorityFilter}
        onPriorityChange={setPriorityFilter}
        categoryFilter={categoryFilter}
        onCategoryChange={setCategoryFilter}
        categories={categories}
      />

      {/* No results from filters */}
      {hasActiveFilters && filteredTodos.length === 0 && (
        <EmptyState
          icon={Search}
          title="No matching tasks"
          subtitle="Try adjusting your search or filters"
        />
      )}

      {/* Pending Section */}
      {(statusFilter === 'ALL' || statusFilter === 'PENDING') && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-lg font-semibold text-zinc-300">
              Pending
            </h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              {pendingTodos.length}
            </span>
          </div>
          {pendingTodos.length === 0 && !hasActiveFilters ? (
            <EmptyState
              icon={CheckCircle2}
              title="All caught up!"
              subtitle="No pending tasks. You're doing great!"
            />
          ) : (
            <div>
              {pendingTodos.map((todo, index) => (
                <TodoItemComponent key={todo.id} todo={todo} index={index} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Completed Section */}
      {(statusFilter === 'ALL' || statusFilter === 'COMPLETED') && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-lg font-semibold text-zinc-300">
              Completed
            </h2>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {completedTodos.length}
            </span>
          </div>
          {completedTodos.length === 0 && !hasActiveFilters ? (
            <EmptyState
              icon={Inbox}
              title="No completed tasks yet"
              subtitle="Check off some tasks to see them here"
            />
          ) : (
            <div>
              {completedTodos.map((todo, index) => (
                <TodoItemComponent key={todo.id} todo={todo} index={index} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
