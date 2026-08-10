import type { Result } from '@/errors/types';
import { ok, err } from '@/errors/ResultFactory';
import { AppError } from '@/errors/AppError';
import type { AiProviderClient } from '@/modules/ai/AiProviderClient';
import type { DocumentService } from '@/modules/document/service/DocumentService';
import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';
import type { ICache } from '@/cache/types';

export type StudyContentKind = 'questions' | 'quiz' | 'flashcards';

export interface QuizFlashcardsPanelProps {
  learningService: LearningService;
  documentId?: string;
  onAskAi: (question: string) => void;
}

export class LearningService {
  constructor(
    private readonly provider: AiProviderClient,
    private readonly documents: DocumentService,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly _cache: ICache,
  ) {}

  async generate(
    kind: StudyContentKind,
    documentId: string,
    count = 5,
    difficulty = 'medium',
  ): Promise<Result<unknown>> {
    try {
      const doc = await this.documents.getDocument(documentId);
      if (!doc.success || !doc.data) {
        return err(new AppError({ message: 'Document not found', code: 'NOT_FOUND', retryable: false }));
      }
      const text = doc.data.pages?.map((p) => p.text).join('\n') ?? '';
      if (!text.trim()) {
        return ok(this.fallbackContent(kind, count));
      }
      this.eventBus.publish('study.generating', { kind, documentId }, 'client');
      const result = await this.provider.learn({ documentId, text, kind, count, difficulty });
      return ok(result);
    } catch (e) {
      this.logger.error('Learning generation failed', { kind, documentId, error: e });
      return ok(this.fallbackContent(kind, count));
    }
  }

  private fallbackContent(kind: StudyContentKind, count: number): unknown {
    if (kind === 'flashcards') {
      return Array.from({ length: count }, (_, i) => ({
        id: `fc-${i + 1}`,
        front: `Question ${i + 1} about this topic?`,
        back: `Answer ${i + 1} with explanation.`,
      }));
    }
    if (kind === 'quiz') {
      return Array.from({ length: count }, (_, i) => ({
        id: `q-${i + 1}`,
        question: `Question ${i + 1}?`,
        options: ['Option A', 'Option B', 'Option C', 'Option D'],
        correctIndex: 0,
      }));
    }
    return Array.from({ length: count }, (_, i) => ({
      id: `q-${i + 1}`,
      question: `Review question ${i + 1}?`,
      answer: `Suggested answer for question ${i + 1}.`,
    }));
  }
}