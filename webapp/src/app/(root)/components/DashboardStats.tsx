'use client';

import { ListChecks, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

interface DashboardStatsProps {
  total: number;
  pending: number;
  completed: number;
  overdue: number;
}

const stats = [
  {
    key: 'total',
    label: 'Total Tasks',
    icon: ListChecks,
    colorClass: 'text-violet-400',
    bgClass: 'bg-violet-500/10',
    borderClass: 'border-violet-500/20',
  },
  {
    key: 'pending',
    label: 'Pending',
    icon: Clock,
    colorClass: 'text-amber-400',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/20',
  },
  {
    key: 'completed',
    label: 'Completed',
    icon: CheckCircle2,
    colorClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/20',
  },
  {
    key: 'overdue',
    label: 'Overdue',
    icon: AlertCircle,
    colorClass: 'text-rose-400',
    bgClass: 'bg-rose-500/10',
    borderClass: 'border-rose-500/20',
  },
] as const;

export default function DashboardStats({ total, pending, completed, overdue }: DashboardStatsProps) {
  const values = { total, pending, completed, overdue };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
      {stats.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.key}
            className={`glass-card rounded-xl p-4 animate-fade-in-up stagger-${index + 1}`}
            style={{ opacity: 0 }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                {stat.label}
              </span>
              <div className={`w-8 h-8 rounded-lg ${stat.bgClass} border ${stat.borderClass} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${stat.colorClass}`} />
              </div>
            </div>
            <p className={`text-2xl font-bold ${stat.colorClass}`}>
              {values[stat.key]}
            </p>
          </div>
        );
      })}
    </div>
  );
}
