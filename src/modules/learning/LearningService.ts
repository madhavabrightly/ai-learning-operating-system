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

export interface GeneratedStudyItem {
  id: string;
  question?: string;
  answer?: string;
  options?: string[];
  correctIndex?: number;
  explanation?: string;
  front?: string;
  back?: string;
}

/**
 * Real learning service. Generates questions/quiz/flashcards through the AI
 * provider (OpenRouter via the Edge Function) with strict JSON parsing.
 * NO hardcoded fallback data — every real failure surfaces to the UI.
 */
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
  ): Promise<Result<GeneratedStudyItem[]>> {
    try {
      const doc = await this.documents.getDocument(documentId);
      if (!doc.success || !doc.data) {
        return err(new AppError({ message: 'Document not found', code: 'NOT_FOUND', retryable: false }));
      }
      const text = doc.data.pages?.map((p) => p.text).join('\n') ?? '';
      if (!text.trim()) {
        return err(new AppError({ message: 'This document has no extractable text yet.', code: 'EMPTY_DOCUMENT', retryable: false }));
      }

      this.eventBus.publish('study.generating', { kind, documentId }, 'client');
      const result = await this.provider.learn({ documentId, text, kind, count, difficulty });

      const items = validateStudyContent(kind, result, count);
      this.eventBus.publish('study.generated', { kind, documentId, count: items.length }, 'client');
      return ok(items);
    } catch (e) {
      const error = AppError.from(e);
      this.logger.error('Learning generation failed', { kind, documentId, error: error.message });
      // Surface the error — never silently return fabricated content.
      return err(error);
    }
  }
}

/** Validate + normalize the model's JSON into typed study items. */
function validateStudyContent(kind: StudyContentKind, raw: unknown, expected: number): GeneratedStudyItem[] {
  if (!Array.isArray(raw)) {
    throw new AppError({ message: 'AI returned an unexpected format for study content.', code: 'JSON_PARSE_ERROR', retryable: false });
  }

  const items: GeneratedStudyItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : `gen-${items.length + 1}`;

    if (kind === 'quiz') {
      const options = Array.isArray(item.options) ? item.options.filter((o): o is string => typeof o === 'string') : [];
      const correctIndex = typeof item.correctIndex === 'number' ? item.correctIndex : -1;
      if (options.length !== 4 || correctIndex < 0 || correctIndex > 3) {
        throw new AppError({
          message: 'AI generated an invalid quiz (each question needs exactly 4 options and one correct answer).',
          code: 'JSON_PARSE_ERROR',
          retryable: false,
        });
      }
      items.push({
        id,
        question: String(item.question ?? ''),
        options,
        correctIndex,
        explanation: typeof item.explanation === 'string' ? item.explanation : undefined,
      });
    } else if (kind === 'flashcards') {
      items.push({
        id,
        front: String(item.front ?? ''),
        back: String(item.back ?? ''),
      });
    } else {
      items.push({
        id,
        question: String(item.question ?? ''),
        answer: String(item.answer ?? ''),
      });
    }
  }

  if (items.length === 0) {
    throw new AppError({ message: 'AI returned no usable study content.', code: 'JSON_PARSE_ERROR', retryable: false });
  }
  return items.slice(0, expected);
}
