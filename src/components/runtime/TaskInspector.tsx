import { useMemo, useState } from 'react';
import type { Task } from '@/runtime/types';
import { CheckCircle2, AlertCircle, RefreshCw, Loader2, Clock } from 'lucide-react';
import { cn } from '@/utils/cn';

interface TaskInspectorProps {
  tasks: Task[];
}

const statusIcon = {
  CREATED: Clock,
  QUEUED: Clock,
  WAITING: Clock,
  RUNNING: Loader2,
  RETRYING: RefreshCw,
  FALLBACK: AlertCircle,
  PARTIAL_SUCCESS: CheckCircle2,
  SUCCESS: CheckCircle2,
  FAILED: AlertCircle,
  CANCELLED: AlertCircle,
  TIMEOUT: AlertCircle,
};

const statusColor = {
  SUCCESS: 'text-status-success',
  PARTIAL_SUCCESS: 'text-status-success',
  RUNNING: 'text-status-running',
  RETRYING: 'text-status-retrying',
  FALLBACK: 'text-status-fallback',
  FAILED: 'text-status-failed',
  CANCELLED: 'text-status-failed',
  TIMEOUT: 'text-status-failed',
  CREATED: 'text-muted-foreground',
  QUEUED: 'text-muted-foreground',
  WAITING: 'text-muted-foreground',
};

export function TaskInspector({ tasks }: TaskInspectorProps) {
  const [selected, setSelected] = useState<Task | null>(null);
  const sorted = useMemo(() => [...tasks].sort((a, b) => a.createdAt - b.createdAt), [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        No tasks yet. Upload a mock document to see task state transitions.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <h3 className="font-heading text-xs font-semibold uppercase text-muted-foreground">Runtime Inspector</h3>
      <div className="flex-1 space-y-2 overflow-auto pr-1">
        {sorted.map((task) => {
          const Icon = statusIcon[task.status];
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => setSelected(task)}
              className={cn(
                'w-full rounded border border-border bg-muted/30 p-2 text-left text-xs transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected?.id === task.id && 'ring-1 ring-ring',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">{task.id}</span>
                <span className={cn('flex items-center gap-1 uppercase', statusColor[task.status])}>
                  <Icon className={cn('h-3 w-3', task.status === 'RUNNING' && 'animate-spin')} />
                  {task.status}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-muted-foreground">
                <span>{task.worker}</span>
                <span>{task.progress}%</span>
              </div>
              {task.retryCount > 0 && (
                <div className="mt-1 text-[10px] text-muted-foreground">Retries: {task.retryCount}</div>
              )}
            </button>
          );
        })}
      </div>
      {selected && (
        <div className="rounded border border-border bg-muted/40 p-3 text-xs">
          <div className="mb-1 font-medium text-foreground">{selected.id} details</div>
          <div className="space-y-1 text-muted-foreground">
            <div>Worker: {selected.worker}</div>
            <div>Status: {selected.status}</div>
            <div>Progress: {selected.progress}%</div>
            <div>Retries: {selected.retryCount}</div>
            <div>Timeout: {selected.timeoutMs}ms</div>
            {selected.recoveryPath && selected.recoveryPath.length > 0 && (
              <div>Recovery: {selected.recoveryPath.join(' → ')}</div>
            )}
            {selected.error && <div className="text-status-failed">Error: {selected.error.message}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
