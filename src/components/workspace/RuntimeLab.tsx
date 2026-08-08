import { useMemo, useState } from 'react';
import type { Task } from '@/runtime/types';
import type { FailureInjector, FailureTarget } from '@/runtime/injection/FailureInjector';
import { Play, RotateCcw, Loader2, AlertCircle, CheckCircle2, RefreshCw, Clock, Bug } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface RuntimeLabProps {
  tasks: Task[];
  runPipeline: (documentId: string) => string | undefined;
  reset: () => void;
  /** Documents available to run a real pipeline on. */
  documents: { id: string; title: string; status: string }[];
  getTelemetry: () => { taskId: string; worker?: string; durationMs: number; retries: number; status: string; errorCategory?: string }[];
  /** Developer-only failure injection (real failures, real retries). */
  failureInjector?: FailureInjector;
}

/**
 * Runtime Lab — real observability over actual pipeline executions.
 * No mock documents, no simulated tasks: every node shown was scheduled,
 * executed, retried, or failed by the real orchestrator.
 */
export function RuntimeLab({ tasks, runPipeline, reset, documents, getTelemetry, failureInjector }: RuntimeLabProps) {
  const [selectedDoc, setSelectedDoc] = useState<string>('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const telemetry = useMemo(() => getTelemetry(), [getTelemetry]);
  const [injectionArmed, setInjectionArmed] = useState(false);

  const run = () => {
    if (!selectedDoc) return;
    runPipeline(selectedDoc);
  };

  const armInjection = (target: FailureTarget) => {
    failureInjector?.configure({ enabled: true, target, times: 1, message: `Injected ${target} failure (developer mode)`, code: 'INJECTED_FAILURE' });
    setInjectionArmed(true);
  };

  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => a.createdAt - b.createdAt), [tasks]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <select
          value={selectedDoc}
          onChange={(e) => setSelectedDoc(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
          aria-label="Select document"
        >
          <option value="">Select an uploaded document…</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title} ({d.status})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={run}
          disabled={!selectedDoc}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" />
          Run pipeline
        </button>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>

      {documents.length === 0 && (
        <p className="rounded border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          No documents uploaded yet. Upload a real document first, then run its pipeline here.
        </p>
      )}

      {/* Developer failure injection — the failure is REAL and retry is REAL.
          Always available (the injector is disabled by default and only fails
          when explicitly armed), but labelled as a developer tool. */}
      {failureInjector && (
        <div className="rounded border border-dashed border-accent/40 bg-accent/5 p-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-[11px] font-medium text-accent">
              <Bug className="h-3 w-3" />
              Failure injection (dev)
            </span>
            {injectionArmed && <span className="text-[10px] text-accent">armed — run the pipeline</span>}
          </div>
          <div className="mt-1.5 flex gap-1">
            <button
              type="button"
              onClick={() => armInjection('parse')}
              className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] text-accent transition-colors hover:bg-accent/20"
            >
              Fail parse once
            </button>
            <button
              type="button"
              onClick={() => armInjection('concepts')}
              className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] text-accent transition-colors hover:bg-accent/20"
            >
              Fail concepts once
            </button>
            <button
              type="button"
              onClick={() => {
                failureInjector.disable();
                setInjectionArmed(false);
              }}
              className="rounded border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/80"
            >
              Disarm
            </button>
          </div>
        </div>
      )}

      {/* Tasks */}
      <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Real executions</h3>
        {sortedTasks.length === 0 ? (
          <p className="text-xs text-muted-foreground">No pipeline runs yet.</p>
        ) : (
          sortedTasks.slice(-30).map((task) => (
            <button
              key={task.id}
              type="button"
              onClick={() => setSelectedTask(task)}
              className={cn(
                'w-full rounded border border-border bg-muted/30 p-2 text-left text-xs transition-colors hover:bg-muted/60',
                selectedTask?.id === task.id && 'ring-1 ring-ring',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">{task.id}</span>
                <StatusBadge status={task.status} retries={task.retryCount} />
              </div>
              <div className="mt-0.5 flex justify-between text-muted-foreground">
                <span>{task.worker}</span>
                <span>{task.progress}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${task.progress}%` }} />
              </div>
            </button>
          ))
        )}
      </div>

      {/* Telemetry */}
      <div className="rounded border border-border bg-muted/30 p-2">
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Telemetry</h3>
        <div className="max-h-24 space-y-0.5 overflow-auto text-[11px] text-muted-foreground">
          {telemetry.slice(-8).map((t) => (
            <div key={t.taskId} className="flex justify-between">
              <span className="truncate">{t.taskId}</span>
              <span>
                {t.worker} · {t.durationMs}ms · {t.retries > 0 ? `${t.retries} retries · ` : ''}{t.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Detail */}
      {selectedTask && (
        <div className="rounded border border-border bg-muted/40 p-3 text-xs">
          <div className="mb-1 font-medium text-foreground">{selectedTask.id}</div>
          <div className="space-y-1 text-muted-foreground">
            <div>Worker: {selectedTask.worker}</div>
            <div>Status: {selectedTask.status}</div>
            <div>Progress: {selectedTask.progress}%</div>
            <div>Retries: {selectedTask.retryCount}</div>
            {selectedTask.recoveryPath && selectedTask.recoveryPath.length > 0 && (
              <div>Recovery: {selectedTask.recoveryPath.join(' → ')}</div>
            )}
            {selectedTask.error && <div className="text-status-failed">Error: {selectedTask.error.message}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, retries }: { status: string; retries: number }) {
  const config: Record<string, { icon: React.ReactNode; color: string }> = {
    SUCCESS: { icon: <CheckCircle2 className="h-3 w-3" />, color: 'text-status-success' },
    PARTIAL_SUCCESS: { icon: <CheckCircle2 className="h-3 w-3" />, color: 'text-status-success' },
    RUNNING: { icon: <Loader2 className="h-3 w-3 animate-spin" />, color: 'text-status-running' },
    RETRYING: { icon: <RefreshCw className="h-3 w-3" />, color: 'text-status-retrying' },
    FALLBACK: { icon: <AlertCircle className="h-3 w-3" />, color: 'text-status-fallback' },
    FAILED: { icon: <AlertCircle className="h-3 w-3" />, color: 'text-status-failed' },
    TIMEOUT: { icon: <AlertCircle className="h-3 w-3" />, color: 'text-status-failed' },
    QUEUED: { icon: <Clock className="h-3 w-3" />, color: 'text-muted-foreground' },
    WAITING: { icon: <Clock className="h-3 w-3" />, color: 'text-muted-foreground' },
    CREATED: { icon: <Clock className="h-3 w-3" />, color: 'text-muted-foreground' },
  };
  const c = config[status] ?? config.QUEUED!;
  return (
    <span className={cn('flex items-center gap-1 uppercase', c.color)}>
      {c.icon}
      {status}
      {retries > 0 ? ` ×${retries}` : ''}
    </span>
  );
}
