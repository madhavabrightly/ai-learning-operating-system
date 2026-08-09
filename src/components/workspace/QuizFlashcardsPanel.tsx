import { useEffect, useState } from 'react';
import { Plus, Trash2, RefreshCw, CheckCircle2, XCircle, Lightbulb, RotateCcw, BookOpen } from 'lucide-react';
import type { LearningService, StudyQuestion, QuizQuestion, Flashcard, Difficulty } from '@/modules/learning/LearningService';
import { cn } from '@/utils/cn';

export interface QuizFlashcardsPanelProps {
  learningService: LearningService;
  documentId?: string;
  onAskAi?: (question: string) => void;
}

type Mode = 'quiz' | 'flashcards' | 'questions';

/**
 * Real study panel: generates quiz questions, flashcards and study questions
 * from the actual document content via the backend AI provider (or the
 * deterministic fallback). Answers are evaluated, flashcards track review
 * state, and everything persists across sessions.
 */
export function QuizFlashcardsPanel({ learningService, documentId, onAskAi }: QuizFlashcardsPanelProps) {
  const [mode, setMode] = useState<Mode>('quiz');
  const [difficulty, setDifficulty] = useState<Difficulty>('beginner');
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [questions, setQuestions] = useState<StudyQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [flipped, setFlipped] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Load persisted flashcards/questions on mount.
    if (!documentId) return;
    let cancelled = false;
    Promise.all([
      learningService.listFlashcards(documentId),
      learningService.listQuestions(documentId),
    ]).then(([f, q]) => {
      if (cancelled) return;
      if (f.success && f.data) setFlashcards(f.data);
      if (q.success && q.data) setQuestions(q.data);
    });
    return () => {
      cancelled = true;
    };
  }, [learningService, documentId]);

  const generate = async () => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      if (mode === 'quiz') {
        const result = await learningService.generateQuiz(documentId, 5, difficulty);
        if (result.success && result.data) {
          setQuiz(result.data);
          setSelectedAnswers({});
          setRevealed({});
        } else setError(result.error ?? 'Failed to generate quiz');
      } else if (mode === 'flashcards') {
        const result = await learningService.generateFlashcards(documentId, 8, difficulty);
        if (result.success && result.data) {
          setFlashcards((prev) => [...result.data!, ...prev]);
          setFlipped(new Set());
        } else setError(result.error ?? 'Failed to generate flashcards');
      } else {
        const result = await learningService.generateQuestions(documentId, 6, difficulty);
        if (result.success && result.data) {
          setQuestions((prev) => [...result.data!, ...prev]);
        } else setError(result.error ?? 'Failed to generate questions');
      }
    } finally {
      setLoading(false);
    }
  };

  const answer = async (question: QuizQuestion, index: number) => {
    if (selectedAnswers[question.id] !== undefined) return;
    setSelectedAnswers((prev) => ({ ...prev, [question.id]: index }));
    const correct = index === question.correctIndex;
    await learningService.submitQuizAnswer({
      quizId: `quiz-${question.documentId}`,
      documentId: question.documentId,
      questionId: question.id,
      selectedIndex: index,
      correct,
    });
    if (correct) {
      setRevealed((prev) => ({ ...prev, [question.id]: true }));
    }
  };

  const review = async (card: Flashcard, correct: boolean) => {
    const result = await learningService.reviewFlashcard(card.id, correct);
    if (result.success && result.data) {
      setFlashcards((prev) => prev.map((c) => (c.id === card.id ? result.data! : c)));
    }
  };

  const deleteCard = async (cardId: string) => {
    await learningService.deleteFlashcard(cardId);
    setFlashcards((prev) => prev.filter((c) => c.id !== cardId));
  };

  const deleteQuestion = async (questionId: string) => {
    await learningService.deleteQuestion(questionId);
    setQuestions((prev) => prev.filter((q) => q.id !== questionId));
  };

  if (!documentId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Open a document to generate quizzes and flashcards from its content.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['quiz', 'flashcards', 'questions'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] capitalize transition-colors',
              mode === m ? 'border-primary bg-primary text-on-primary' : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted',
            )}
          >
            {m === 'questions' ? 'Study questions' : m}
          </button>
        ))}
        <select
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as Difficulty)}
          className="ml-auto rounded-full border border-border bg-background px-2 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none"
          aria-label="Difficulty"
        >
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        {mode === 'quiz' && (
          <>
            {quiz.length === 0 && <EmptyHint text="Generate a quiz from the document content." />}
            {quiz.map((q, qi) => {
              const chosen = selectedAnswers[q.id];
              const isRevealed = revealed[q.id] || chosen !== undefined;
              const correct = chosen === q.correctIndex;
              return (
                <div key={q.id} className="rounded border border-border bg-muted/30 p-3">
                  <p className="text-sm font-medium text-foreground">
                    {qi + 1}. {q.question}
                  </p>
                  <div className="mt-2 grid gap-1">
                    {q.options.map((opt, oi) => {
                      const isCorrect = oi === q.correctIndex;
                      const isChosen = chosen === oi;
                      return (
                        <button
                          key={oi}
                          type="button"
                          onClick={() => void answer(q, oi)}
                          disabled={chosen !== undefined}
                          className={cn(
                            'rounded border px-2 py-1 text-left text-xs transition-colors',
                            isRevealed && isCorrect && 'border-status-success bg-status-success/10 text-foreground',
                            isRevealed && isChosen && !isCorrect && 'border-destructive bg-destructive/10 text-foreground',
                            !isRevealed && 'border-border bg-background hover:bg-muted',
                            chosen !== undefined && 'cursor-default',
                          )}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {isRevealed && (
                    <div className="mt-2 flex items-start gap-1.5 text-xs">
                      {correct ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-success" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                      )}
                      <span className="text-muted-foreground">
                        {correct ? 'Correct!' : `Incorrect. The answer is: ${q.options[q.correctIndex]}`}
                        {q.explanation ? ` — ${q.explanation}` : ''}
                      </span>
                    </div>
                  )}
                  {(q.sourceSection || q.sourcePage) && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {q.sourceSection && `Section: ${q.sourceSection}`}
                      {q.sourcePage ? ` · page ${q.sourcePage}` : ''} · {q.difficulty}
                    </p>
                  )}
                </div>
              );
            })}
          </>
        )}

        {mode === 'flashcards' && (
          <>
            {flashcards.length === 0 && <EmptyHint text="Generate flashcards from the document content." />}
            {flashcards.map((card) => {
              const isFlipped = flipped.has(card.id);
              return (
                <div key={card.id} className="rounded border border-border bg-muted/30 p-3">
                  <button
                    type="button"
                    onClick={() =>
                      setFlipped((prev) => {
                        const next = new Set(prev);
                        if (next.has(card.id)) next.delete(card.id);
                        else next.add(card.id);
                        return next;
                      })
                    }
                    className="w-full text-left"
                  >
                    {isFlipped ? (
                      <p className="text-sm text-foreground">{card.back}</p>
                    ) : (
                      <p className="text-sm font-medium text-foreground">{card.front}</p>
                    )}
                    <p className="mt-1 text-[10px] uppercase text-muted-foreground">
                      {isFlipped ? 'Click to flip back' : 'Click to flip'}
                    </p>
                  </button>
                  {isFlipped && (
                    <div className="mt-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void review(card, true)}
                        className="inline-flex items-center gap-1 rounded bg-status-success/15 px-2 py-0.5 text-[11px] text-status-success hover:bg-status-success/25"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Got it
                      </button>
                      <button
                        type="button"
                        onClick={() => void review(card, false)}
                        className="inline-flex items-center gap-1 rounded bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/20"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Again
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteCard(card.id)}
                        className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted"
                        aria-label="Delete flashcard"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {card.concept && <span className="rounded bg-muted px-1.5 py-0.5">{card.concept}</span>}
                    <span className="rounded bg-muted px-1.5 py-0.5 capitalize">{card.review.status}</span>
                    {card.review.reviewCount > 0 && <span>reviewed {card.review.reviewCount}×</span>}
                    {card.sourcePage ? <span>page {card.sourcePage}</span> : null}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {mode === 'questions' && (
          <>
            {questions.length === 0 && <EmptyHint text="Generate study questions from the document content." />}
            {questions.map((q) => (
              <div key={q.id} className="rounded border border-border bg-muted/30 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{q.question}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    {onAskAi && (
                      <button
                        type="button"
                        onClick={() => onAskAi(q.question)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted"
                        aria-label="Ask AI"
                        title="Ask the AI assistant"
                      >
                        <BookOpen className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void deleteQuestion(q.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted"
                      aria-label="Delete question"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5 capitalize">{q.type}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 capitalize">{q.difficulty}</span>
                  {q.sourceSection && <span>Section: {q.sourceSection}</span>}
                  {q.sourcePage ? <span> · page {q.sourcePage}</span> : null}
                </div>
                {q.answerHint && (
                  <details className="mt-2">
                    <summary className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                      <Lightbulb className="h-3 w-3" />
                      Answer hint
                    </summary>
                    <p className="mt-1 rounded bg-background p-2 text-xs text-foreground">{q.answerHint}</p>
                  </details>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {mode === 'quiz' && quiz.length > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {Object.keys(revealed).length}/{quiz.length} answered
          </span>
          <button
            type="button"
            onClick={() => {
              setQuiz([]);
              setSelectedAnswers({});
              setRevealed({});
            }}
            className="ml-auto inline-flex items-center gap-1 rounded border border-border bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/80"
          >
            <RefreshCw className="h-3 w-3" />
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="rounded border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">{text}</p>
  );
}
