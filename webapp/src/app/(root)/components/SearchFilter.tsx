'use client';

import { Search, SlidersHorizontal } from 'lucide-react';

export type StatusFilter = 'ALL' | 'PENDING' | 'COMPLETED';
export type PriorityFilter = 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

interface SearchFilterProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  priorityFilter: PriorityFilter;
  onPriorityChange: (priority: PriorityFilter) => void;
  categoryFilter: string;
  onCategoryChange: (category: string) => void;
  categories: string[];
}

export default function SearchFilter({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusChange,
  priorityFilter,
  onPriorityChange,
  categoryFilter,
  onCategoryChange,
  categories,
}: SearchFilterProps) {
  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'COMPLETED', label: 'Completed' },
  ];

  const priorityOptions: { value: PriorityFilter; label: string }[] = [
    { value: 'ALL', label: 'All Priorities' },
    { value: 'LOW', label: 'Low' },
    { value: 'MEDIUM', label: 'Medium' },
    { value: 'HIGH', label: 'High' },
    { value: 'URGENT', label: 'Urgent' },
  ];

  return (
    <div className="glass-card rounded-xl p-4 mb-6 animate-fade-in-up" style={{ animationDelay: '0.2s', opacity: 0 }}>
      {/* Search Bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Search tasks..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl glass-input text-sm text-zinc-200 placeholder-zinc-600"
        />
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status Pills */}
        <div className="flex items-center gap-1.5">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onStatusChange(option.value)}
              className={statusFilter === option.value ? 'filter-pill-active' : 'filter-pill'}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-white/[0.08] hidden sm:block" />

        {/* Priority Dropdown */}
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500" />
          <select
            value={priorityFilter}
            onChange={(e) => onPriorityChange(e.target.value as PriorityFilter)}
            className="glass-input rounded-lg px-3 py-1.5 text-xs text-zinc-300 cursor-pointer"
          >
            {priorityOptions.map((option) => (
              <option key={option.value} value={option.value} className="bg-zinc-900 text-zinc-300">
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Category Dropdown */}
        {categories.length > 0 && (
          <>
            <div className="w-px h-6 bg-white/[0.08] hidden sm:block" />
            <select
              value={categoryFilter}
              onChange={(e) => onCategoryChange(e.target.value)}
              className="glass-input rounded-lg px-3 py-1.5 text-xs text-zinc-300 cursor-pointer"
            >
              <option value="" className="bg-zinc-900 text-zinc-300">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat} className="bg-zinc-900 text-zinc-300">
                  {cat}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </div>
  );
}
