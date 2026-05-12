'use client';

import { AlertTriangle, Flame, Minus, ArrowDown } from 'lucide-react';

const priorityConfig = {
  LOW: {
    label: 'Low',
    className: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    icon: ArrowDown,
  },
  MEDIUM: {
    label: 'Medium',
    className: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    icon: Minus,
  },
  HIGH: {
    label: 'High',
    className: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
    icon: AlertTriangle,
  },
  URGENT: {
    label: 'Urgent',
    className: 'bg-red-500/10 text-red-400 border border-red-500/20',
    icon: Flame,
  },
};

interface PriorityBadgeProps {
  priority: keyof typeof priorityConfig;
  showIcon?: boolean;
  size?: 'sm' | 'md';
}

export default function PriorityBadge({ priority, showIcon = true, size = 'sm' }: PriorityBadgeProps) {
  const config = priorityConfig[priority];
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${config.className} ${
        size === 'sm' ? 'px-2 py-0.5 text-[0.6875rem]' : 'px-2.5 py-1 text-xs'
      }`}
    >
      {showIcon && <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />}
      {config.label}
    </span>
  );
}

export { priorityConfig };
