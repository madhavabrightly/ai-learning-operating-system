import { useState, useCallback } from 'react';
import { GraduationCap, Lightbulb, CheckCircle2 } from 'lucide-react';
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
}

interface StudyQuestion {
  id: string;
  question: string;
  answer: string;
}

type Content = Flashcard[] | QuizQuestion[] | StudyQuestion[];

export function QuizFlashcardsPanel({ learningService, documentId, onAskAi }: QuizFlashcardsPanelProps) {
  const [mode, setMode] = useState<StudyContentKind>('questions');
  const [content, setContent] = useState<Content | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const generate = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setError(undefined);
    setContent(undefined);
    setFlipped(new Set());
    setAnswers({});
    const result = await learningService.generate(mode, documentId, 5);
    if (result.success && result.data) {
      setContent(result.data as Content);
    } else {
      setError(result.error ?? 'Generation failed');
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

  const answerQuestion = (id: string, index: number) => {
    setAnswers((prev) => ({ ...prev, [id]: index }));
  };

  const contentItems = content ?? [];
  const isFlashcards = mode === 'flashcards';
  const isQuiz = mode === 'quiz';

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
        className="flex items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
      >
        <Lightbulb className="h-3 w-3" />
        {loading ? 'Generating…' : 'Generate study content'}
      </button>

      {!documentId && (
        <p className="text-center text-xs text-muted-foreground">Open a document to generate study content.</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {documentId && !loading && !content && (
        <p className="flex flex-1 items-center justify-center text-center text-xs text-muted-foreground">
          Generate questions, a quiz, or flashcards from the current document.
        </p>
      )}

      <div className="flex-1 space-y-2 overflow-auto">
        {isFlashcards &&
          (contentItems as Flashcard[]).map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => flipCard(card.id)}
              className="w-full rounded-lg border border-border bg-muted/20 p-3 text-left text-xs transition-colors hover:bg-muted"
            >
              {flipped.has(card.id) ? (
                <span className="text-foreground">{card.back}</span>
              ) : (
                <span className="font-medium text-primary">{card.front}</span>
              )}
            </button>
          ))}

        {isQuiz &&
          (contentItems as QuizQuestion[]).map((q) => (
            <div key={q.id} className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <p className="mb-2 font-medium text-foreground">{q.question}</p>
              <div className="space-y-1">
                {q.options.map((option, i) => {
                  const chosen = answers[q.id] === i;
                  const correct = i === q.correctIndex;
                  const revealed = answers[q.id] !== undefined;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => answerQuestion(q.id, i)}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded border px-2 py-1 text-left text-[11px] transition-colors',
                        revealed && correct && 'border-status-success bg-status-success/10 text-status-success',
                        revealed && chosen && !correct && 'border-status-failed bg-status-failed/10 text-status-failed',
                        !revealed && 'border-border bg-background text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {revealed && correct && <CheckCircle2 className="h-3 w-3" />}
                      {option}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

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