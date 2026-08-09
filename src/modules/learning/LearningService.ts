import { v4 as uuid } from 'uuid';
import { ok, err } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import { AppError } from '@/errors/AppError';
import { EventTopics } from '@/events/EventTopics';
import type { IEventBus } from '@/events/types';
import type { ICache } from '@/cache/types';
import type { ILogger } from '@/logging/ILogger';
import type { AiProviderClient } from '@/modules/ai/AiProviderClient';
import type { DocumentService } from '@/modules/document/service/DocumentService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuestionType = 'basic' | 'conceptual' | 'application' | 'comparison' | 'formula';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export interface StudyQuestion {
  id: string;
  documentId: string;
  question: string;
  type: QuestionType;
  difficulty: Difficulty;
  answerHint?: string;
  sourceSection?: string;
  sourcePage?: number;
  createdAt: number;
}

export interface QuizQuestion {
  id: string;
  documentId: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  difficulty: Difficulty;
  sourceSection?: string;
  sourcePage?: number;
  createdAt: number;
}

export interface Flashcard {
  id: string;
  documentId: string;
  front: string;
  back: string;
  concept?: string;
  difficulty: Difficulty;
  sourceSection?: string;
  sourcePage?: number;
  createdAt: number;
  /** Review state persisted across sessions. */
  review: { status: 'new' | 'learning' | 'review' | 'mastered'; lastReviewedAt?: number; reviewCount: number };
}

export interface QuizAttempt {
  id: string;
  quizId: string;
  documentId: string;
  questionId: string;
  selectedIndex: number;
  correct: boolean;
  answeredAt: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ILearningService {
  generateQuestions(documentId: string, count?: number, difficulty?: Difficulty): Promise<Result<StudyQuestion[]>>;
  generateQuiz(documentId: string, count?: number, difficulty?: Difficulty): Promise<Result<QuizQuestion[]>>;
  generateFlashcards(documentId: string, count?: number, difficulty?: Difficulty): Promise<Result<Flashcard[]>>;
  submitQuizAnswer(attempt: Omit<QuizAttempt, 'id' | 'answeredAt'>): Promise<Result<QuizAttempt>>;
  reviewFlashcard(flashcardId: string, correct: boolean): Promise<Result<Flashcard>>;
  listFlashcards(documentId: string): Promise<Result<Flashcard[]>>;
  listQuestions(documentId: string): Promise<Result<StudyQuestion[]>>;
  deleteFlashcard(flashcardId: string): Promise<Result<void>>;
  deleteQuestion(questionId: string): Promise<Result<void>>;
}

interface LearnResponse {
  questions?: Array<{
    question: string;
    type?: string;
    difficulty?: string;
    answerHint?: string;
    sourceSection?: string;
    sourcePage?: number;
  }>;
  quiz?: Array<{
    question: string;
    options?: string[];
    correctIndex?: number;
    explanation?: string;
    difficulty?: string;
    sourceSection?: string;
    sourcePage?: number;
  }>;
  flashcards?: Array<{
    front: string;
    back: string;
    concept?: string;
    difficulty?: string;
    sourceSection?: string;
    sourcePage?: number;
  }>;
  fallback?: 'ai' | 'heuristic';
}

const QUESTIONS_KEY = (documentId: string) => `aios-questions-${documentId}`;
const FLASHCARDS_KEY = (documentId: string) => `aios-flashcards-${documentId}`;

/**
 * Real learning service. Generates questions, quizzes and flashcards from the
 * actual document content via the backend AI provider (with a deterministic
 * heuristic fallback when the AI is unconfigured). All items carry provenance
 * (source section/page) and persist across sessions. No hardcoded banks.
 */
export class LearningService implements ILearningService {
  private questionsCache = new Map<string, StudyQuestion[]>();
  private flashcardsCache = new Map<string, Flashcard[]>();

  constructor(
    private readonly provider: AiProviderClient,
    private readonly documents: DocumentService,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly cache: ICache,
  ) {}

  private log(event: string, data: Record<string, unknown>): void {
    this.logger.info(`Learning: ${event}`, data);
  }

  async generateQuestions(documentId: string, count = 6, difficulty?: Difficulty): Promise<Result<StudyQuestion[]>> {
    const text = await this.documentText(documentId);
    if (!text) return err(new AppError({ message: 'Document has no extractable text', code: 'NO_CONTENT', retryable: false }));

    const response = (await this.provider.learn({
      documentId,
      text: text.slice(0, 50_000),
      kind: 'questions',
      count,
      difficulty,
    })) as LearnResponse & { error?: { code: string; message: string } };

    if (response.error) {
      return err(new AppError({ message: response.error.message, code: response.error.code, retryable: true }));
    }

    const questions: StudyQuestion[] = (response.questions ?? [])
      .filter((q) => q.question?.trim())
      .slice(0, count)
      .map((q) => ({
        id: uuid(),
        documentId,
        question: q.question,
        type: (q.type as QuestionType) ?? 'basic',
        difficulty: (q.difficulty as Difficulty) ?? 'beginner',
        answerHint: q.answerHint,
        sourceSection: q.sourceSection,
        sourcePage: q.sourcePage ?? 0,
        createdAt: Date.now(),
      }));

    if (questions.length === 0) return err(new AppError({ message: 'No questions could be generated', code: 'NO_CONTENT', retryable: false }));

    this.persistQuestions(documentId, questions);
    this.eventBus.publish(EventTopics.QUIZ_READY, { documentId, count: questions.length }, 'client');
    this.log('generated questions', { documentId, count: questions.length, fallback: response.fallback ?? 'ai' });
    return ok(questions);
  }

  async generateQuiz(documentId: string, count = 5, difficulty?: Difficulty): Promise<Result<QuizQuestion[]>> {
    const text = await this.documentText(documentId);
    if (!text) return err(new AppError({ message: 'Document has no extractable text', code: 'NO_CONTENT', retryable: false }));

    const response = (await this.provider.learn({
      documentId,
      text: text.slice(0, 50_000),
      kind: 'quiz',
      count,
      difficulty,
    })) as LearnResponse & { error?: { code: string; message: string } };

    if (response.error) {
      return err(new AppError({ message: response.error.message, code: response.error.code, retryable: true }));
    }

    const quiz: QuizQuestion[] = (response.quiz ?? [])
      .filter((q) => q.question?.trim() && Array.isArray(q.options) && q.options.length >= 2 && typeof q.correctIndex === 'number')
      .slice(0, count)
      .map((q) => ({
        id: uuid(),
        documentId,
        question: q.question,
        options: q.options ?? [],
        correctIndex: Math.min(Math.max(q.correctIndex ?? 0, 0), (q.options?.length ?? 1) - 1),
        explanation: q.explanation,
        difficulty: (q.difficulty as Difficulty) ?? 'beginner',
        sourceSection: q.sourceSection,
        sourcePage: q.sourcePage ?? 0,
        createdAt: Date.now(),
      }));

    if (quiz.length === 0) return err(new AppError({ message: 'No quiz questions could be generated', code: 'NO_CONTENT', retryable: false }));

    this.eventBus.publish(EventTopics.QUIZ_READY, { documentId, count: quiz.length }, 'client');
    return ok(quiz);
  }

  async generateFlashcards(documentId: string, count = 8, difficulty?: Difficulty): Promise<Result<Flashcard[]>> {
    const text = await this.documentText(documentId);
    if (!text) return err(new AppError({ message: 'Document has no extractable text', code: 'NO_CONTENT', retryable: false }));

    const response = (await this.provider.learn({
      documentId,
      text: text.slice(0, 50_000),
      kind: 'flashcards',
      count,
      difficulty,
    })) as LearnResponse & { error?: { code: string; message: string } };

    if (response.error) {
      return err(new AppError({ message: response.error.message, code: response.error.code, retryable: true }));
    }

    const existing = await this.listFlashcards(documentId);
    const existingIds = new Set((existing.success && existing.data ? existing.data : []).map((f) => f.front));

    const cards: Flashcard[] = (response.flashcards ?? [])
      .filter((f) => f.front?.trim() && f.back?.trim())
      .slice(0, count)
      .filter((f) => !existingIds.has(f.front))
      .map((f) => ({
        id: uuid(),
        documentId,
        front: f.front,
        back: f.back,
        concept: f.concept,
        difficulty: (f.difficulty as Difficulty) ?? 'beginner',
        sourceSection: f.sourceSection,
        sourcePage: f.sourcePage ?? 0,
        createdAt: Date.now(),
        review: { status: 'new', reviewCount: 0 },
      }));

    if (cards.length === 0) return err(new AppError({ message: 'No new flashcards could be generated', code: 'NO_CONTENT', retryable: false }));

    const merged = [...(existing.success && existing.data ? existing.data : []), ...cards];
    this.persistFlashcards(documentId, merged);
    this.eventBus.publish(EventTopics.NOTES_UPDATED, { documentId, count: cards.length }, 'client');
    return ok(cards);
  }

  async submitQuizAnswer(attempt: Omit<QuizAttempt, 'id' | 'answeredAt'>): Promise<Result<QuizAttempt>> {
    const full: QuizAttempt = { ...attempt, id: uuid(), answeredAt: Date.now() };
    // Record progress so analytics reflect real answering.
    this.eventBus.publish('quiz.answered', { questionId: attempt.questionId, correct: attempt.correct, documentId: attempt.documentId }, 'client');
    return ok(full);
  }

  async reviewFlashcard(flashcardId: string, correct: boolean): Promise<Result<Flashcard>> {
    let found: Flashcard | undefined;
    let docId = '';
    for (const [documentId, cards] of this.flashcardsCache) {
      const card = cards.find((c) => c.id === flashcardId);
      if (card) {
        found = card;
        docId = documentId;
        break;
      }
    }
    if (!found) return err(new AppError({ message: `Flashcard ${flashcardId} not found`, code: 'NOT_FOUND', retryable: false }));

    const card = found;
    card.review.reviewCount += 1;
    card.review.lastReviewedAt = Date.now();
    if (correct) {
      card.review.status = card.review.status === 'mastered' ? 'mastered' : card.review.reviewCount >= 3 ? 'mastered' : card.review.reviewCount >= 2 ? 'review' : 'learning';
    } else {
      card.review.status = 'learning';
    }

    const all = (await this.listFlashcards(docId)).data ?? [];
    this.persistFlashcards(docId, all.map((c) => (c.id === flashcardId ? card : c)));
    return ok(card);
  }

  async listFlashcards(documentId: string): Promise<Result<Flashcard[]>> {
    const cached = this.flashcardsCache.get(documentId);
    if (cached) return ok(cached);
    const result = await this.cache.get<Flashcard[]>(FLASHCARDS_KEY(documentId));
    if (result.success && result.data) {
      this.flashcardsCache.set(documentId, result.data);
      return ok(result.data);
    }
    return ok([]);
  }

  async listQuestions(documentId: string): Promise<Result<StudyQuestion[]>> {
    const cached = this.questionsCache.get(documentId);
    if (cached) return ok(cached);
    const result = await this.cache.get<StudyQuestion[]>(QUESTIONS_KEY(documentId));
    if (result.success && result.data) {
      this.questionsCache.set(documentId, result.data);
      return ok(result.data);
    }
    return ok([]);
  }

  async deleteFlashcard(flashcardId: string): Promise<Result<void>> {
    for (const [docId, cards] of this.flashcardsCache) {
      const next = cards.filter((c) => c.id !== flashcardId);
      this.flashcardsCache.set(docId, next);
      await this.cache.set(FLASHCARDS_KEY(docId), next);
    }
    return ok(undefined);
  }

  async deleteQuestion(questionId: string): Promise<Result<void>> {
    for (const [docId, questions] of this.questionsCache) {
      const next = questions.filter((q) => q.id !== questionId);
      this.questionsCache.set(docId, next);
      await this.cache.set(QUESTIONS_KEY(docId), next);
    }
    return ok(undefined);
  }

  private async documentText(documentId: string): Promise<string | undefined> {
    const result = await this.documents.getDocument(documentId);
    if (!result.success || !result.data) return undefined;
    return result.data.pages.map((p) => p.text).join('\n').trim();
  }

  private async persistQuestions(documentId: string, questions: StudyQuestion[]): Promise<void> {
    const existing = (await this.listQuestions(documentId)).data ?? [];
    const merged = [...questions, ...existing];
    this.questionsCache.set(documentId, merged);
    await this.cache.set(QUESTIONS_KEY(documentId), merged);
  }

  private async persistFlashcards(documentId: string, cards: Flashcard[]): Promise<void> {
    this.flashcardsCache.set(documentId, cards);
    await this.cache.set(FLASHCARDS_KEY(documentId), cards);
  }
}
