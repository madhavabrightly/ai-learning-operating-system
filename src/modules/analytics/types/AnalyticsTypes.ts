import type { Result } from '@/errors/types';

export interface StudyMetrics {
  totalStudyTimeMinutes: number;
  documentsStudied: number;
  conceptsStudied: number;
  conceptsLearned: number;
  weakConcepts: string[];
  quizAccuracy: number;
  revisionCompletion: number;
  streakDays: number;
  sessionsCompleted: number;
}

export interface ProcessingMetrics {
  documentsUploaded: number;
  averageProcessingTimeMs: number;
  pipelineSuccessRate: number;
  recoveryCount: number;
  retriesAverage: number;
  failedPipelines: number;
}

export interface StudySession {
  id: string;
  startedAt: number;
  endedAt?: number;
  documentIds: string[];
  conceptIds: string[];
  questionsAnswered: number;
  correctAnswers: number;
}

export interface IAnalyticsService {
  getStudyMetrics(): Promise<Result<StudyMetrics>>;
  getProcessingMetrics(): Promise<Result<ProcessingMetrics>>;
  getSessions(): Promise<Result<StudySession[]>>;
  recordSession(session: StudySession): Promise<Result<void>>;
}
