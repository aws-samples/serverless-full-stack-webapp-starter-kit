'use client';

import { type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon: Icon, title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 animate-fade-in-up">
      <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-5">
        <Icon className="w-7 h-7 text-zinc-600" />
      </div>
      <h3 className="text-lg font-semibold text-zinc-400 mb-1.5">{title}</h3>
      {subtitle && (
        <p className="text-sm text-zinc-600 text-center max-w-xs">{subtitle}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
