import { ok } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import type { ICache } from '@/cache/types';
import type { IAnalyticsService, ProcessingMetrics, StudyMetrics, StudySession } from '../types/AnalyticsTypes';
import type { RuntimeOrchestrator } from '@/runtime/scheduler/RuntimeOrchestrator';

const METRICS_KEY = 'aios-study-metrics';
const SESSIONS_KEY = 'aios-study-sessions';

export class AnalyticsService implements IAnalyticsService {
  private orchestratorRef?: RuntimeOrchestrator;

  constructor(private readonly cache: ICache) {}

  /** Attach the orchestrator so processing metrics come from real telemetry. */
  attachOrchestrator(orchestrator: RuntimeOrchestrator): void {
    this.orchestratorRef = orchestrator;
  }

  async getStudyMetrics(): Promise<Result<StudyMetrics>> {
    const result = await this.cache.get<StudyMetrics>(METRICS_KEY);
    return result.success && result.data ? ok(result.data) : ok(defaultStudyMetrics());
  }

  async getProcessingMetrics(): Promise<Result<ProcessingMetrics>> {
    const telemetry = this.orchestratorRef?.getTelemetry() ?? [];
    const completed = telemetry.filter((t) => t.status === 'SUCCESS' || t.status === 'PARTIAL_SUCCESS' || t.status === 'FAILED');
    const succeeded = telemetry.filter((t) => t.status === 'SUCCESS' || t.status === 'PARTIAL_SUCCESS');
    const retriesTotal = telemetry.reduce((s, t) => s + t.retries, 0);
    const recoveryCount = telemetry.filter((t) => (t.recoveryPath?.length ?? 0) > 0).length;

    return ok({
      documentsUploaded: telemetry.length > 0 ? new Set(telemetry.map((t) => t.correlationId)).size : 0,
      averageProcessingTimeMs: completed.length > 0 ? Math.round(completed.reduce((s, t) => s + t.durationMs, 0) / completed.length) : 0,
      pipelineSuccessRate: completed.length > 0 ? succeeded.length / completed.length : 0,
      recoveryCount,
      retriesAverage: telemetry.length > 0 ? retriesTotal / telemetry.length : 0,
    });
  }

  async getSessions(): Promise<Result<StudySession[]>> {
    const result = await this.cache.get<StudySession[]>(SESSIONS_KEY);
    return ok(result.success && result.data ? result.data : []);
  }

  async recordSession(session: StudySession): Promise<Result<void>> {
    const existing = await this.cache.get<StudySession[]>(SESSIONS_KEY);
    const sessions = existing.success && existing.data ? existing.data : [];
    sessions.push(session);
    await this.cache.set(SESSIONS_KEY, sessions);

    const metrics = await this.getStudyMetrics();
    if (metrics.success && metrics.data) {
      const next: StudyMetrics = {
        ...metrics.data,
        totalStudyTimeMinutes: metrics.data.totalStudyTimeMinutes + Math.round(((session.endedAt ?? Date.now()) - session.startedAt) / 60000),
        sessionsCompleted: metrics.data.sessionsCompleted + 1,
        documentsStudied: new Set([...session.documentIds, ...Array(metrics.data.documentsStudied).fill('')]).size,
        conceptsStudied: new Set([...session.conceptIds, ...Array(metrics.data.conceptsStudied).fill('')]).size,
      };
      await this.cache.set(METRICS_KEY, next);
    }

    return ok(undefined);
  }
}

function defaultStudyMetrics(): StudyMetrics {
  return {
    totalStudyTimeMinutes: 0,
    documentsStudied: 0,
    conceptsStudied: 0,
    conceptsLearned: 0,
    weakConcepts: [],
    quizAccuracy: 0,
    revisionCompletion: 0,
    streakDays: 0,
    sessionsCompleted: 0,
  };
}
