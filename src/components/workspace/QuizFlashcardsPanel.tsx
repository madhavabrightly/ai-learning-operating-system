import { useEffect, useState, useCallback, useRef } from 'react';
import { GraduationCap, Lightbulb, CheckCircle2, RefreshCw, Target, AlertTriangle } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { LearningService, StudyContentKind } from '@/modules/learning/LearningService';

export interface QuizFlashcardsPanelProps {
  learningService: LearningService;
  documentId?: string;
  onAskAi: (question: string) => void;
}

interface Flashcard {
  id: string;
  front: string;
  back: string;
}

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

interface StudyQuestion {
  id: string;
  question: string;
  answer: string;
}

type Content = Flashcard[] | QuizQuestion[] | StudyQuestion[];

interface QuizScore {
  correct: number;
  total: number;
}

/**
 * Study panel: questions / quiz / flashcards generated from the current
 * document through the OpenRouter Edge Function (strict JSON via
 * LearningService). The quiz flow validates each answer, evaluates it against
 * the model's correctIndex, calculates a running score, and records wrong
 * answers as weak concepts on the knowledge graph. Malformed AI output
 * surfaces as a readable error with a one-click retry — never a silent blank.
 */
export function QuizFlashcardsPanel({ learningService, documentId, onAskAi: _onAskAi }: QuizFlashcardsPanelProps) {
  const [mode, setMode] = useState<StudyContentKind>('quiz');
  const [content, setContent] = useState<Content | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [score, setScore] = useState<QuizScore | undefined>();
  const [weakConcepts, setWeakConcepts] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  const generate = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setError(undefined);
    setContent(undefined);
    setFlipped(new Set());
    setAnswers({});
    setScore(undefined);
    setWeakConcepts([]);
    submittedRef.current = false;
    const result = await learningService.generate(mode, documentId, 5);
    if (result.success && result.data) {
      setContent(result.data as Content);
    } else {
      setError(result.error ?? 'Generation failed — try again.');
    }
    setLoading(false);
  }, [learningService, mode, documentId]);

  const flipCard = (id: string) => {
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const quizItems = (mode === 'quiz' ? (content as QuizQuestion[] | undefined) : undefined) ?? [];

  const answerQuestion = (id: string, index: number) => {
    if (submittedRef.current) return; // locked after evaluation
    setAnswers((prev) => {
      if (prev[id] !== undefined) return prev; // already answered
      return { ...prev, [id]: index };
    });
  };

  // Evaluate the quiz once every question is answered.
  useEffect(() => {
    if (mode !== 'quiz' || quizItems.length === 0) return;
    const answeredCount = quizItems.filter((q) => answers[q.id] !== undefined).length;
    if (answeredCount < quizItems.length || submittedRef.current) return;
    submittedRef.current = true;

    const results = quizItems.map((q) => ({
      question: q.question,
      correct: answers[q.id] === q.correctIndex,
    }));
    const correct = results.filter((r) => r.correct).length;
    setScore({ correct, total: results.length });

    // Update weak concepts on the knowledge graph from wrong answers.
    void (async () => {
      setSubmitting(true);
      const result = await learningService.recordQuizResult(documentId ?? '', results);
      if (result.success) {
        setWeakConcepts(result.data ?? []);
      }
      setSubmitting(false);
    })();
  }, [mode, quizItems, answers, learningService, documentId]);

  const contentItems = content ?? [];
  const isFlashcards = mode === 'flashcards';
  const isQuiz = mode === 'quiz';
  const scorePct = score && score.total > 0 ? Math.round((score.correct / score.total) * 100) : undefined;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground">
          <GraduationCap className="h-3 w-3" /> Study
        </h3>
        <div className="flex gap-1">
          {(['questions', 'quiz', 'flashcards'] as StudyContentKind[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'rounded border px-2 py-1 text-[11px] capitalize transition-colors',
                mode === m ? 'border-primary bg-primary text-on-primary' : 'border-border bg-muted/30 text-muted-foreground',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={generate}
        disabled={!documentId || loading}
        className="flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:bg-muted active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Lightbulb className="h-3 w-3" />
        {loading ? 'Generating…' : error ? 'Retry generation' : 'Generate study content'}
      </button>

      {!documentId && (
        <p className="text-center text-xs text-muted-foreground">Open a document to generate study content.</p>
      )}

      {error && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <span className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {error}
              {error.includes('JSON') && ' The model returned something unexpected — hit retry and we’ll ask it again.'}
            </span>
          </span>
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded border border-destructive/40 px-2 py-1 text-[10px] font-medium transition-colors hover:bg-destructive/10 active:scale-[0.97] disabled:opacity-40"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}

      {documentId && !loading && !content && !error && (
        <p className="flex flex-1 items-center justify-center text-center text-xs text-muted-foreground">
          Generate questions, a quiz, or flashcards from the current document.
        </p>
      )}

      {isQuiz && score && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2 text-xs">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <Target className="h-3.5 w-3.5 text-primary" />
            Score: {score.correct} / {score.total}
            {scorePct !== undefined && <span className="text-muted-foreground">({scorePct}%)</span>}
          </span>
          {submitting ? (
            <span className="text-[10px] text-muted-foreground">Updating weak concepts…</span>
          ) : weakConcepts.length > 0 ? (
            <span className="text-[10px] text-muted-foreground">
              Weak concepts: <span className="text-destructive">{weakConcepts.slice(0, 4).join(', ')}{weakConcepts.length > 4 ? '…' : ''}</span>
            </span>
          ) : (
            <span className="text-[10px] text-status-success">All concepts mastered — great job!</span>
          )}
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-auto">
        {isFlashcards &&
          (contentItems as Flashcard[]).map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => flipCard(card.id)}
              className="w-full cursor-pointer rounded-lg border border-border bg-muted/20 p-3 text-left text-xs transition-all hover:bg-muted active:scale-[0.99]"
            >
              {flipped.has(card.id) ? (
                <span className="text-foreground">{card.back}</span>
              ) : (
                <span className="font-medium text-primary">{card.front}</span>
              )}
            </button>
          ))}

        {isQuiz &&
          quizItems.map((q) => {
            const chosen = answers[q.id];
            const revealed = chosen !== undefined;
            return (
              <div key={q.id} className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
                <p className="mb-2 font-medium text-foreground">{q.question}</p>
                <div className="space-y-1">
                  {q.options.map((option, i) => {
                    const correct = i === q.correctIndex;
                    const isChosen = chosen === i;
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={revealed}
                        onClick={() => answerQuestion(q.id, i)}
                        className={cn(
                          'flex w-full items-center gap-1.5 rounded border px-2 py-1 text-left text-[11px] transition-colors',
                          revealed && correct && 'border-status-success bg-status-success/10 text-status-success',
                          revealed && isChosen && !correct && 'border-status-failed bg-status-failed/10 text-status-failed',
                          revealed && !correct && !isChosen && 'border-border bg-background text-muted-foreground/60',
                          !revealed && 'cursor-pointer border-border bg-background text-muted-foreground hover:bg-muted active:scale-[0.99]',
                        )}
                      >
                        {revealed && correct && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                        {revealed && isChosen && !correct && <span className="h-3 w-3 shrink-0 rounded-full border border-status-failed" />}
                        {option}
                      </button>
                    );
                  })}
                </div>
                {revealed && q.explanation && (
                  <p className="mt-1.5 border-l-2 border-primary/50 pl-2 text-[10px] italic text-muted-foreground">
                    {q.explanation}
                  </p>
                )}
              </div>
            );
          })}

        {!isFlashcards &&
          !isQuiz &&
          (contentItems as StudyQuestion[]).map((q) => (
            <div key={q.id} className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <p className="font-medium text-foreground">{q.question}</p>
              <p className="mt-1 text-muted-foreground">{q.answer}</p>
            </div>
          ))}
      </div>
    </div>
  );
}
