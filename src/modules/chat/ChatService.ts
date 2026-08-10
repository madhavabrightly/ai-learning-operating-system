import { v4 as uuid } from 'uuid';
import { ok, err } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import { AppError } from '@/errors/AppError';
import { EventTopics } from '@/events/EventTopics';
import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';
import type { AiProviderClient, GroundingContext, AiActionIntent, GroundedSource } from '@/modules/ai/AiProviderClient';
import type { DocumentService } from '@/modules/document/service/DocumentService';
import { retrieveChunks } from '@/modules/document/retrieval/retrieval';
import type { IGraphService } from '@/modules/graph/types/GraphTypes';
import type { ChatMessage, ChatPersistence, Conversation, ChatSource } from './ChatTypes';

export interface ChatServiceDeps {
  provider: AiProviderClient;
  documents: DocumentService;
  persistence: ChatPersistence;
  eventBus: IEventBus;
  logger: ILogger;
  graph?: IGraphService;
}

export interface SendMessageOptions {
  stream?: boolean;
  onDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  onStatus?: (status: ChatMessage['status']) => void;
  signal?: AbortSignal;
}

export interface ChatResult {
  message: ChatMessage;
  conversation: Conversation;
  sources?: ChatSource[];
}

export interface IChatService {
  sendMessage(conversationId: string | undefined, content: string, context: { documentId?: string; selection?: string }, options?: SendMessageOptions): Promise<Result<ChatResult>>;
  runAction(conversationId: string, intent: AiActionIntent, context: { documentId?: string; selection?: string }): Promise<Result<ChatResult>>;
  regenerate(conversationId: string, context: { documentId?: string; selection?: string }, options?: SendMessageOptions): Promise<Result<ChatResult>>;
  followUp(conversationId: string, context: { documentId?: string; selection?: string }, options?: SendMessageOptions): Promise<Result<ChatResult>>;
  research(conversationId: string, query: string, context: { documentId?: string; url?: string }): Promise<Result<ChatResult>>;
  listConversations(): Promise<Result<Conversation[]>>;
  loadConversation(conversationId: string): Promise<Result<ChatMessage[]>>;
  newConversation(documentId?: string): Conversation;
  deleteConversation(conversationId: string): Promise<Result<void>>;
}

/**
 * Real chat service. Builds a budgeted, grounded prompt from the actual
 * document, streams responses from the Edge Function (OpenRouter), attaches
 * numbered sources for provenance, and persists every message.
 */
export class ChatService implements IChatService {
  constructor(private readonly deps: ChatServiceDeps) {}

  newConversation(documentId?: string): Conversation {
    const now = Date.now();
    return { id: uuid(), title: 'New conversation', documentId, createdAt: now, updatedAt: now };
  }

  /** Create and persist a new conversation. */
  async createConversation(documentId?: string): Promise<Conversation> {
    const conversation = this.newConversation(documentId);
    await this.deps.persistence.saveConversation(conversation);
    return conversation;
  }

  async sendMessage(
    conversationId: string | undefined,
    content: string,
    context: { documentId?: string; selection?: string },
    options: SendMessageOptions = {},
  ): Promise<Result<ChatResult>> {
    try {
      if (!content.trim()) return err(new AppError({ message: 'Message is empty', code: 'VALIDATION_ERROR', retryable: false }));

      const effectiveConversation = await this.resolveConversation(conversationId, context.documentId);

      const userMessage: ChatMessage = {
        id: uuid(),
        conversationId: effectiveConversation.id,
        role: 'user',
        content,
        createdAt: Date.now(),
        status: 'complete',
        documentId: context.documentId,
      };
      await this.deps.persistence.saveMessage(userMessage);

      const grounding = await this.buildGroundingContext(context.documentId, context.selection);
      const history = await this.loadForPrompt(effectiveConversation.id);
      const request = {
        conversationId: effectiveConversation.id,
        messages: [...history, { role: 'user' as const, content }],
        context: grounding,
        stream: options.stream ?? true,
      };

      const assistantId = uuid();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        conversationId: effectiveConversation.id,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        status: 'sending',
        documentId: context.documentId,
      };
      await this.deps.persistence.saveMessage(assistantMessage);
      options.onStatus?.('sending');

      if (request.stream) {
        let full = '';
        let reasoning = '';
        await this.deps.provider.streamChat(request, {
          signal: options.signal,
          onReasoningDelta: (delta) => {
            reasoning += delta;
            options.onReasoningDelta?.(delta);
          },
          onDelta: (delta) => {
            full += delta;
            assistantMessage.content = full;
            assistantMessage.status = 'streaming';
            options.onDelta?.(delta);
          },
          onDone: async () => {
            assistantMessage.content = full;
            assistantMessage.reasoning = reasoning || undefined;
            assistantMessage.status = 'complete';
            assistantMessage.sources = this.toSources(grounding);
            await this.deps.persistence.saveMessage(assistantMessage);
            options.onStatus?.('complete');
            this.publish(EventTopics.ASSISTANT_RESPONSE, { conversationId: effectiveConversation.id, message: assistantMessage });
          },
          onError: async (error) => {
            assistantMessage.status = 'error';
            assistantMessage.reasoning = reasoning || undefined;
            assistantMessage.error = error.message;
            assistantMessage.content = full || error.message;
            assistantMessage.sources = this.toSources(grounding);
            await this.deps.persistence.saveMessage(assistantMessage);
            options.onStatus?.('error');
          },
        });
      } else {
        const response = await this.deps.provider.chat(request);
        assistantMessage.content = response.content;
        assistantMessage.status = 'complete';
        assistantMessage.sources = this.toSources(grounding);
        await this.deps.persistence.saveMessage(assistantMessage);
        options.onStatus?.('complete');
      }

      return ok({ message: assistantMessage, conversation: effectiveConversation, sources: assistantMessage.sources });
    } catch (e) {
      const error = AppError.from(e);
      return err(error);
    }
  }

  async runAction(
    conversationId: string,
    intent: AiActionIntent,
    context: { documentId?: string; selection?: string },
  ): Promise<Result<ChatResult>> {
    try {
      const effective = await this.resolveConversation(conversationId, context.documentId);
      const grounding = await this.buildGroundingContext(context.documentId, context.selection);

      const userMessage: ChatMessage = {
        id: uuid(),
        conversationId: effective.id,
        role: 'user',
        content: `Action: ${intent}\n${context.selection ? `Selection: "${context.selection}"` : ''}`,
        createdAt: Date.now(),
        status: 'complete',
        documentId: context.documentId,
      };
      await this.deps.persistence.saveMessage(userMessage);

      const response = await this.deps.provider.action({
        intent,
        context: grounding,
        messages: [{ role: 'user', content: context.selection ?? grounding?.sections?.[0]?.text ?? '' }],
      });

      const assistantMessage: ChatMessage = {
        id: uuid(),
        conversationId: effective.id,
        role: 'assistant',
        content: response.content,
        createdAt: Date.now(),
        status: 'complete',
        documentId: context.documentId,
        sources: this.toSources(grounding),
      };
      await this.deps.persistence.saveMessage(assistantMessage);
      this.publish(EventTopics.ASSISTANT_RESPONSE, { conversationId: effective.id, message: assistantMessage, sources: assistantMessage.sources });
      return ok({ message: assistantMessage, conversation: effective, sources: assistantMessage.sources });
    } catch (e) {
      return err(AppError.from(e));
    }
  }

  /**
   * Regenerate: drop the last assistant reply (and any trailing user/error
   * placeholders) and re-run the AI against the last real user message.
   */
  async regenerate(
    conversationId: string,
    context: { documentId?: string; selection?: string },
    options: SendMessageOptions = {},
  ): Promise<Result<ChatResult>> {
    try {
      const conversation = await this.getConversation(conversationId);
      if (!conversation) return err(new AppError({ message: 'Conversation not found', code: 'NOT_FOUND', retryable: false }));

      const messages = await this.deps.persistence.listMessages(conversationId);
      // Find the last complete user message; drop everything after it.
      let lastUserIndex = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user' && messages[i].status === 'complete') {
          lastUserIndex = i;
          break;
        }
      }
      if (lastUserIndex === -1) {
        return err(new AppError({ message: 'No user message to regenerate', code: 'VALIDATION_ERROR', retryable: false }));
      }

      const lastUser = messages[lastUserIndex];
      for (const m of messages.slice(lastUserIndex + 1)) {
        await this.deps.persistence.deleteMessage(m.id);
      }

      return this.sendMessage(
        conversationId,
        lastUser.content,
        { documentId: lastUser.documentId ?? context.documentId, selection: context.selection },
        options,
      );
    } catch (e) {
      return err(AppError.from(e));
    }
  }

  /** Follow-up: ask the AI to propose follow-up questions about the last reply. */
  async followUp(
    conversationId: string,
    context: { documentId?: string; selection?: string },
    options: SendMessageOptions = {},
  ): Promise<Result<ChatResult>> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) return err(new AppError({ message: 'Conversation not found', code: 'NOT_FOUND', retryable: false }));
    const messages = await this.deps.persistence.listMessages(conversationId);
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.status === 'complete');
    const base = lastAssistant?.content ?? context.selection ?? '';
    return this.sendMessage(
      conversationId,
      `Suggest 3 focused follow-up questions about the topic we just discussed. Base them strictly on the source material.\n\nLast reply:\n${base.slice(0, 1500)}`,
      { documentId: context.documentId, selection: context.selection },
      options,
    );
  }

  async research(
    conversationId: string,
    query: string,
    context: { documentId?: string; url?: string },
  ): Promise<Result<ChatResult>> {
    try {
      const effective = await this.resolveConversation(conversationId, context.documentId);

      const userMessage: ChatMessage = {
        id: uuid(),
        conversationId: effective.id,
        role: 'user',
        content: `Research: ${query}${context.url ? ` (${context.url})` : ''}`,
        createdAt: Date.now(),
        status: 'complete',
        documentId: context.documentId,
      };
      await this.deps.persistence.saveMessage(userMessage);

      let assistantMessage: ChatMessage;
      try {
        const researchResult = await this.deps.provider.research(query.trim() || (context.url ?? ''), context.url);
        if (researchResult.mechanism === 'error' || researchResult.error) {
          throw new AppError({ message: researchResult.error?.message ?? 'Research failed', code: 'RESEARCH_ERROR', retryable: false });
        }
        // Ground the answer in the actual evidence: feed sources to the AI.
        const sources = researchResult.evidence;
        const grounding: GroundingContext = {
          documentId: context.documentId,
          sources: sources.map((s) => ({ url: s.url, title: s.title, text: s.relevantText, retrievedAt: s.retrievedAt })),
          retrievedAt: Date.now(),
        };
        const answerRequest = {
          conversationId: effective.id,
          messages: [
            { role: 'user' as const, content: `Summarize the research findings for: ${query}. Cite sources inline like [1], [2].` },
          ],
          context: grounding,
          stream: false,
        };
        const ai = await this.deps.provider.chat(answerRequest);
        assistantMessage = {
          id: uuid(),
          conversationId: effective.id,
          role: 'assistant',
          content: ai.content,
          createdAt: Date.now(),
          status: 'complete',
          documentId: context.documentId,
          sources: sources.map((s) => ({ ...s })),
        };
      } catch (e) {
        const error = AppError.from(e);
        assistantMessage = {
          id: uuid(),
          conversationId: effective.id,
          role: 'assistant',
          content: `I couldn't complete the research: ${error.message}`,
          createdAt: Date.now(),
          status: 'error',
          error: error.message,
          documentId: context.documentId,
        };
      }
      await this.deps.persistence.saveMessage(assistantMessage);
      this.publish(EventTopics.ASSISTANT_RESPONSE, { conversationId: effective.id, message: assistantMessage, sources: assistantMessage.sources });
      return ok({ message: assistantMessage, conversation: effective, sources: assistantMessage.sources });
    } catch (e) {
      return err(AppError.from(e));
    }
  }

  async listConversations(): Promise<Result<Conversation[]>> {
    const list = await this.deps.persistence.listConversations();
    return ok(list);
  }

  async loadConversation(conversationId: string): Promise<Result<ChatMessage[]>> {
    const messages = await this.deps.persistence.listMessages(conversationId);
    return ok(messages);
  }

  async deleteConversation(conversationId: string): Promise<Result<void>> {
    await this.deps.persistence.deleteConversation(conversationId);
    return ok(undefined);
  }

  /**
   * Resolve the conversation to attach a message to, persisting it so the
   * thread survives reloads. Follow-ups reuse the existing conversation by id
   * (direct IndexedDB lookup — not a list scan) so history never fragments
   * into orphan threads.
   */
  private async resolveConversation(conversationId: string | undefined, documentId?: string): Promise<Conversation> {
    if (conversationId) {
      const existing = await this.getConversation(conversationId);
      if (existing) {
        existing.updatedAt = Date.now();
        await this.deps.persistence.saveConversation(existing);
        return existing;
      }
    }
    const conversation = this.newConversation(documentId);
    await this.deps.persistence.saveConversation(conversation);
    return conversation;
  }

  private async getConversation(conversationId: string): Promise<Conversation | undefined> {
    return this.deps.persistence.getConversation(conversationId);
  }

  private async loadForPrompt(conversationId: string): Promise<{ role: 'system' | 'user' | 'assistant'; content: string }[]> {
    const messages = await this.deps.persistence.listMessages(conversationId);
    // Exclude streaming/error placeholders; the prompt builder keeps the last
    // 6 complete rounds to respect the context budget.
    return messages
      .filter((m) => m.status === 'complete' && m.content.trim())
      .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.content }));
  }

  /** Build grounded context + inject graph concepts for provenance. */
  private async buildGroundingContext(documentId?: string, selection?: string): Promise<GroundingContext | undefined> {
    if (!documentId) {
      return selection ? { selection } : undefined;
    }
    const docResult = await this.deps.documents.getDocument(documentId);
    if (!docResult.success || !docResult.data) {
      return selection ? { selection, documentId } : { documentId };
    }
    const doc = docResult.data;
    const queryText = selection ?? doc.title;

    const chunks = retrieveChunks(doc, queryText, 6, 1800);
    const grounding: GroundingContext = {
      documentId,
      documentTitle: doc.title,
      pages: chunks.map((c) => ({ page: c.page, text: c.text })),
      selection,
      retrievedAt: Date.now(),
    };
    const sections = chunks
      .map((c) => (c.sectionTitle ? { title: c.sectionTitle, text: c.text, page: c.page } : undefined))
      .filter((s): s is { title: string; text: string; page: number } => Boolean(s));
    if (sections.length > 0) grounding.sections = sections;
    if (doc.formulas.length > 0) grounding.formulas = doc.formulas.slice(0, 8).map((f) => ({ id: f.id, tex: f.tex, page: f.page }));
    if (doc.tables.length > 0) grounding.tables = doc.tables.slice(0, 4).map((t) => ({ id: t.id, page: t.page, rows: t.rows.map((r) => r.map((c) => c.text)) }));

    // Inject graph nodes for the current document when available — lets the
    // assistant reason over concept relationships, not just raw text.
    if (this.deps.graph) {
      try {
        const graphResult = await this.deps.graph.load(documentId);
        if (graphResult.success && graphResult.data) {
          const g = graphResult.data;
          if (g.concepts.length > 0) {
            grounding.pages = [
              ...(grounding.pages ?? []),
              {
                page: 0,
                text: `Key concepts in this document: ${g.concepts
                  .slice(0, 12)
                  .map((c) => `${c.label}${c.description ? ` — ${c.description.slice(0, 120)}` : ''}`)
                  .join('; ')}`,
              },
            ];
          }
        }
      } catch {
        // Graph is optional — never block chat on it.
      }
    }
    return grounding;
  }

  /** Convert the grounding context into numbered ChatSources for the UI. */
  private toSources(grounding?: GroundingContext): ChatSource[] | undefined {
    if (!grounding) return undefined;
    const out: ChatSource[] = [];
    const pages = grounding.pages ?? [];
    pages.forEach((p, i) => {
      if (p.page === 0 && p.text.startsWith('Key concepts')) return; // graph node block is not a source
      out.push({
        sourceId: `doc-page-${p.page}-${i}`,
        url: grounding.documentId ? `document://${grounding.documentId}#page=${p.page}` : '',
        title: grounding.documentTitle ? `${grounding.documentTitle} — Page ${p.page}` : `Page ${p.page}`,
        domain: 'document',
        retrievedAt: grounding.retrievedAt ?? Date.now(),
        relevantText: p.text.slice(0, 300),
        confidence: 1,
        requestId: grounding.documentId ?? '',
      });
    });
    grounding.sources?.forEach((s, i) => {
      out.push({
        sourceId: `web-${i}`,
        url: s.url,
        title: s.title,
        domain: safeDomain(s.url),
        retrievedAt: s.retrievedAt,
        relevantText: s.text.slice(0, 300),
        confidence: 1,
        requestId: '',
      });
    });
    return out.length > 0 ? out : undefined;
  }

  private publish(topic: string, payload: unknown): void {
    this.deps.eventBus.publish(topic, payload, 'client');
  }
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
