import { useState, useMemo } from 'react';
import { Activity, Play, RotateCcw } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { Task, TelemetrySnapshot } from '@/runtime/types';
import type { FailureInjector } from '@/runtime/injection/FailureInjector';

export interface RuntimeLabProps {
  tasks: Task[];
  runPipeline: (documentId: string) => void;
  reset: () => void;
  documents: { id: string; title: string; status?: string }[];
  getTelemetry: () => TelemetrySnapshot[];
  failureInjector: FailureInjector;
}

const STATUS_COLORS: Record<string, string> = {
  CREATED: 'text-status-queued',
  QUEUED: 'text-status-queued',
  RUNNING: 'text-status-running',
  WAITING: 'text-muted-foreground',
  RETRYING: 'text-status-retrying',
  FALLBACK: 'text-status-fallback',
  PARTIAL_SUCCESS: 'text-status-fallback',
  SUCCESS: 'text-status-success',
  FAILED: 'text-status-failed',
  CANCELLED: 'text-muted-foreground',
  TIMEOUT: 'text-status-failed',
};

export function RuntimeLab({ tasks, runPipeline, reset, documents, getTelemetry, failureInjector }: RuntimeLabProps) {
  const [tab, setTab] = useState<'tasks' | 'telemetry' | 'injector'>('tasks');
  const telemetry = useMemo(() => getTelemetry(), [getTelemetry]);

  const handleRunPipeline = () => {
    const doc = documents[0];
    if (doc) runPipeline(doc.id);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          <Activity className="mr-1 inline h-3 w-3" />
          Runtime Inspector
        </h3>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleRunPipeline}
            disabled={documents.length === 0}
            className="flex items-center gap-1 rounded border border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Play className="h-3 w-3" /> Run
          </button>
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1 rounded border border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border pb-1">
        <TabBtn active={tab === 'tasks'} onClick={() => setTab('tasks')}>Tasks ({tasks.length})</TabBtn>
        <TabBtn active={tab === 'telemetry'} onClick={() => setTab('telemetry')}>Telemetry ({telemetry.length})</TabBtn>
        <TabBtn active={tab === 'injector'} onClick={() => setTab('injector')}>Injector</TabBtn>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'tasks' && (
          <div className="space-y-1">
            {tasks.length === 0 && (
              <p className="py-8 text-center text-xs text-muted-foreground">No tasks. Upload a document and click Run.</p>
            )}
            {tasks.map((task) => (
              <div key={task.id} className="rounded border border-border bg-muted/20 p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{task.id}</span>
                  <span className={cn('font-medium', STATUS_COLORS[task.status] ?? 'text-muted-foreground')}>
                    {task.status}
                  </span>
                </div>
                <div className="flex gap-2 text-[10px] text-muted-foreground">
                  <span>Worker: {task.worker}</span>
                  <span>Retries: {task.retryCount}</span>
                </div>
                {task.progress > 0 && (
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'telemetry' && (
          <div className="space-y-1">
            {telemetry.length === 0 && (
              <p className="py-8 text-center text-xs text-muted-foreground">No telemetry data yet.</p>
            )}
            {telemetry.map((t, i) => (
              <div key={i} className="rounded border border-border bg-muted/20 p-2 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{t.worker ?? 'unknown'}</span>
                  <span className="text-muted-foreground">{t.durationMs}ms</span>
                </div>
                <div className="text-muted-foreground">
                  {t.taskId.slice(0, 24)} · {t.status} · retries: {t.retries}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'injector' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Simulate worker failures to test retry/recovery.</p>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={failureInjector.isEnabled}
                onChange={() => failureInjector.toggle()}
                className="rounded border-border accent-primary"
              />
              <span>Failure injection enabled</span>
            </label>
            <div className="space-y-2">
              {['parser', 'knowledge'].map((type) => (
                <div key={type} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-muted-foreground">{type}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={failureInjector.rates.get(type) ?? 0}
                    onChange={(e) => failureInjector.setRate(type, parseFloat(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                  <span className="w-8 text-muted-foreground">{Math.round((failureInjector.rates.get(type) ?? 0) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-2 py-1 text-[11px] font-medium transition-colors',
        active ? 'bg-primary text-on-primary' : 'text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}