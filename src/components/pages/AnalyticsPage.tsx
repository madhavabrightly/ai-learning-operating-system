import { useEffect, useState } from 'react';
import { useDependency } from '@/hooks/useContainer';
import { TOKENS } from '@/di/tokens';
import type { IAnalyticsService, StudyMetrics, ProcessingMetrics } from '@/modules/analytics/types/AnalyticsTypes';

export function AnalyticsPage() {
  const analytics = useDependency<IAnalyticsService>(TOKENS.analyticsService);
  const [study, setStudy] = useState<StudyMetrics | null>(null);
  const [processing, setProcessing] = useState<ProcessingMetrics | null>(null);

  useEffect(() => {
    void analytics.getStudyMetrics().then((r) => {
      if (r.success && r.data) setStudy(r.data);
    });
    void analytics.getProcessingMetrics().then((r) => {
      if (r.success && r.data) setProcessing(r.data);
    });
  }, [analytics]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h2 className="font-heading text-lg font-semibold text-foreground">Analytics</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Study time" value={study ? `${study.totalStudyTimeMinutes}m` : '—'} />
        <StatCard label="Documents studied" value={study ? String(study.documentsStudied) : '—'} />
        <StatCard label="Concepts studied" value={study ? String(study.conceptsStudied) : '—'} />
        <StatCard label="Sessions" value={study ? String(study.sessionsCompleted) : '—'} />
        <StatCard label="Quiz accuracy" value={study ? `${Math.round(study.quizAccuracy * 100)}%` : '—'} />
        <StatCard label="Streak" value={study ? `${study.streakDays}d` : '—'} />
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Pipeline processing</h3>
        {processing ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="Documents" value={String(processing.documentsUploaded)} />
            <StatCard label="Avg time" value={`${processing.averageProcessingTimeMs}ms`} />
            <StatCard label="Success rate" value={`${Math.round(processing.pipelineSuccessRate * 100)}%`} />
            <StatCard label="Recoveries" value={String(processing.recoveryCount)} />
            <StatCard label="Avg retries" value={processing.retriesAverage.toFixed(2)} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading pipeline metrics…</p>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
