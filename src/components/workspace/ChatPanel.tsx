import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { Send, Sparkles, ExternalLink, Square, RotateCcw, CornerDownRight } from 'lucide-react';
import type { ChatStore } from '@/store/ChatStore';
import type { AiActionIntent } from '@/modules/ai/AiProviderClient';
import { cn } from '@/utils/cn';
import { MathRenderer } from '@/components/workspace/MathRenderer';

const ACTIONS: { intent: AiActionIntent; label: string }[] = [
  { intent: 'explain', label: 'Explain' },
  { intent: 'simplify', label: 'Simplify' },
  { intent: 'summarize', label: 'Summarize' },
  { intent: 'teach', label: 'Teach' },
  { intent: 'example', label: 'Example' },
  { intent: 'compare', label: 'Compare' },
  { intent: 'quiz', label: 'Quiz' },
  { intent: 'flashcards', label: 'Flashcards' },
  { intent: 'notes', label: 'Notes' },
];

export interface ChatPanelProps {
  chat: ChatStore;
  documentId?: string;
  selection?: string;
  onOpenSource: (url: string) => void;
}

export function ChatPanel({ chat, documentId, selection, onOpenSource }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [researchMode, setResearchMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // FIX 3 — auto-scroll: keep the newest token in view whenever the message
  // list, the live stream, or the live reasoning block changes.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chat.messages, chat.liveText, chat.liveReasoning, chat.sending, chat.streaming]);

  const send = () => {
    if (!input.trim() || chat.sending) return;
    const content = input;
    setInput('');
    if (researchMode) {
      const trimmed = content.trim();
      let url: string | undefined;
      let query = trimmed;
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          url = parsed.toString();
          query = '';
        }
      } catch {
        // Not a URL — treat as a query.
      }
      void chat.research(query || trimmed, { documentId, url });
      setResearchMode(false);
    } else {
      void chat.sendMessage(content, { documentId, selection });
    }
  };

  const runAction = (intent: AiActionIntent) => {
    void chat.runAction(intent, { documentId, selection });
  };

  const lastAssistantComplete = chat.messages.some((m) => m.role === 'assistant' && m.status === 'complete');

  return (
    <div className="flex h-full flex-col">
      {/* Conversation list */}
      <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1">
        {chat.conversations.slice(0, 8).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => void chat.selectConversation(c.id)}
            className={cn(
              'whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] transition-colors',
              chat.activeConversationId === c.id
                ? 'border-primary bg-primary text-on-primary'
                : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted',
            )}
          >
            {c.title === 'New conversation' ? `Conversation ${c.id.slice(0, 4)}` : c.title}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void chat.newConversation(documentId)}
          className="whitespace-nowrap rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
        >
          + New
        </button>
      </div>

      {/* Actions */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {ACTIONS.map((a) => (
          <button
            key={a.intent}
            type="button"
            onClick={() => runAction(a.intent)}
            disabled={chat.sending}
            className="rounded border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setResearchMode((v) => !v)}
          className={cn(
            'flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] transition-colors',
            researchMode ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted',
          )}
        >
          <Sparkles className="h-3 w-3" />
          Research
        </button>

        {/* Regenerate / Follow-up only make sense after a completed answer. */}
        {lastAssistantComplete && !chat.sending && (
          <>
            <button
              type="button"
              onClick={() => void chat.regenerate({ documentId, selection })}
              className="flex items-center gap-1 rounded border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Regenerate the last answer"
            >
              <RotateCcw className="h-3 w-3" />
              Regenerate
            </button>
            <button
              type="button"
              onClick={() => void chat.followUp({ documentId, selection })}
              className="flex items-center gap-1 rounded border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Suggest follow-up questions"
            >
              <CornerDownRight className="h-3 w-3" />
              Follow-up
            </button>
          </>
        )}
      </div>

      {chat.error && (
        <div role="alert" className="mb-2 rounded border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
          {chat.error}
          <button type="button" onClick={chat.clearError} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
        {chat.messages.length === 0 && !chat.sending && (
          <p className="pt-8 text-center text-xs text-muted-foreground">
            Ask a question about the document, or use an action button above.
            {selection && <span className="mt-2 block text-foreground/70">Selected text: “{selection.slice(0, 80)}…”</span>}
          </p>
        )}
        {chat.messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} reasoning={m.reasoning} status={m.status} error={m.error} />
        ))}
        {/* Live reasoning (thinking phase) — surfaced so the stream never looks stalled */}
        {chat.streaming && chat.liveReasoning && <ThinkingBlock reasoning={chat.liveReasoning} />}
        {chat.sending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Working…
          </div>
        )}
        {/* Live streaming bubble — rendered through the same markdown pipeline */}
        {chat.streaming && chat.liveText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
              <MarkdownContent text={chat.liveText} />
              <span className="ml-0.5 inline-block animate-pulse">▍</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Sources — numbered to match inline citations [1], [2] */}
      {chat.sources.length > 0 && (
        <div className="mt-2 rounded border border-border bg-muted/30 p-2">
          <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Sources ({chat.sources.length})</p>
          <div className="max-h-28 space-y-1 overflow-auto">
            {chat.sources.map((s, i) => (
              <button
                key={s.sourceId}
                type="button"
                onClick={() => onOpenSource(s.url)}
                className="flex w-full items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1 text-left text-[11px] transition-colors hover:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-medium text-primary">
                    {i + 1}
                  </span>
                  <span className="truncate text-foreground">{s.title}</span>
                </span>
                <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input wrapped in a form so Enter is handled natively with preventDefault */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="mt-2 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={researchMode ? 'Research query (web)…' : 'Ask about the document…'}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {chat.sending || chat.streaming ? (
          <button
            type="button"
            onClick={chat.stop}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
            aria-label="Stop generating"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary/90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown + LaTeX rendering (FIX 4)
// ---------------------------------------------------------------------------

/**
 * Renders assistant markdown with GFM (tables, strikethrough) and math.
 * `remark-math` turns $...$ / $$...$$ into <code class="language-math …">
 * nodes; the custom `code` component routes those through MathRenderer (the
 * existing KaTeX component) while everything else renders as real markdown.
 */
function MarkdownContent({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      components={{
        pre: MarkdownPre,
        code: MarkdownCode,
        a: MarkdownLink,
        p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
        h1: ({ children }) => <h1 className="mb-1 mt-2 text-base font-semibold text-foreground">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-1 mt-2 text-[15px] font-semibold text-foreground">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold text-foreground">{children}</h3>,
        h4: ({ children }) => <h4 className="mb-1 mt-1.5 text-sm font-medium text-foreground">{children}</h4>,
        h5: ({ children }) => <h5 className="mb-1 mt-1.5 text-sm font-medium text-foreground">{children}</h5>,
        h6: ({ children }) => <h6 className="mb-1 mt-1.5 text-sm font-medium text-foreground">{children}</h6>,
        ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
        li: ({ children }) => <li className="my-0.5">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em>{children}</em>,
        blockquote: ({ children }) => (
          <blockquote className="my-1 border-l-2 border-border pl-2 italic text-muted-foreground">{children}</blockquote>
        ),
        hr: () => <hr className="my-2 border-border" />,
        table: MarkdownTable,
        th: MarkdownTableHeader,
        td: MarkdownTableCell,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/** Unwrap the <pre> so fenced blocks render through the styled code component. */
function MarkdownPre({ children }: { children?: React.ReactNode }) {
  return <div className="my-1.5">{children}</div>;
}

function MarkdownCode({ className, children }: { className?: string; children?: React.ReactNode }) {
  const classNames = className ?? '';
  const text = String(children ?? '').replace(/\n$/, '');

  // Math: $...$, $$...$$ (remark-math) and ```math fences all land here with
  // the `language-math` class — render via the existing MathRenderer.
  if (classNames.includes('language-math')) {
    const tex = text.trim();
    const inline = classNames.includes('math-inline');
    return <MathRenderer tex={tex} inline={inline} fallbackText={tex} />;
  }

  // Fenced code block with a language tag.
  const lang = classNames.match(/language-([\w-]+)/)?.[1];
  if (lang) {
    return (
      <div className="overflow-x-auto rounded-lg border border-border bg-background/80">
        <div className="border-b border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {lang}
        </div>
        <pre className="overflow-x-auto p-2 text-xs leading-relaxed">
          <code className="text-foreground">{text}</code>
        </pre>
      </div>
    );
  }

  // Inline code.
  return <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-foreground">{children}</code>;
}

function MarkdownLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
    >
      {children}
    </a>
  );
}

function MarkdownTable({ children }: { children?: React.ReactNode }) {
  return (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  );
}

function MarkdownTableHeader({ children }: { children?: React.ReactNode }) {
  return <th className="border border-border bg-muted px-2 py-1 font-medium text-foreground">{children}</th>;
}

function MarkdownTableCell({ children }: { children?: React.ReactNode }) {
  return <td className="border border-border px-2 py-1">{children}</td>;
}

// ---------------------------------------------------------------------------
// Reasoning / thinking block (FIX 1 UI)
// ---------------------------------------------------------------------------

/** Expandable "Thinking…" block showing reasoning tokens while streaming or from history. */
function ThinkingBlock({ reasoning }: { reasoning: string }) {
  return (
    <details className="mb-2 rounded border border-border bg-muted/30">
      <summary className="cursor-pointer select-none px-2 py-1 text-xs font-medium italic text-gray-400">
        Thinking…
      </summary>
      <div className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-border px-2 py-1.5 text-xs italic leading-relaxed text-gray-400">
        {reasoning}
      </div>
    </details>
  );
}

function MessageBubble({
  role,
  content,
  reasoning,
  status,
  error,
}: {
  role: string;
  content: string;
  reasoning?: string;
  status: string;
  error?: string;
}) {
  const isUser = role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser ? 'whitespace-pre-wrap bg-primary text-on-primary' : 'border border-border bg-muted/40 text-foreground',
          status === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
        )}
      >
        {isUser ? (
          content
        ) : (
          <>
            {reasoning && <ThinkingBlock reasoning={reasoning} />}
            <MarkdownContent text={content} />
          </>
        )}
        {status === 'streaming' && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
        {error && status === 'error' && <span className="mt-1 block text-xs opacity-70">⚠ {error}</span>}
      </div>
    </div>
  );
}
