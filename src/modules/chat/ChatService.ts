import { v4 as uuid } from 'uuid';
import { ok, err } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import { AppError } from '@/errors/AppError';
import { EventTopics } from '@/events/EventTopics';
import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';
import type { AiProviderClient, GroundingContext, AiActionIntent } from '@/modules/ai/AiProviderClient';
import type { DocumentService } from '@/modules/document/service/DocumentService';
import { retrieveChunks } from '@/modules/document/retrieval/retrieval';
import type { ChatMessage, ChatPersistence, Conversation } from './ChatTypes';

export interface ChatServiceDeps {
  provider: AiProviderClient;
  documents: DocumentService;
  persistence: ChatPersistence;
  eventBus: IEventBus;
  logger: ILogger;
}

export interface SendMessageOptions {
  stream?: boolean;
  onDelta?: (delta: string) => void;
  onStatus?: (status: ChatMessage['status']) => void;
  signal?: AbortSignal;
}

export interface ChatResult {
  message: ChatMessage;
  conversation: Conversation;
  sources?: ChatMessage['sources'];
}

export interface IChatService {
  sendMessage(conversationId: string | undefined, content: string, context: { documentId?: string; selection?: string }, options?: SendMessageOptions): Promise<Result<ChatResult>>;
  runAction(conversationId: string, intent: AiActionIntent, context: { documentId?: string; selection?: string }): Promise<Result<ChatResult>>;
  research(conversationId: string, query: string, context: { documentId?: string }): Promise<Result<ChatResult>>;
  listConversations(): Promise<Result<Conversation[]>>;
  loadConversation(conversationId: string): Promise<Result<ChatMessage[]>>;
  newConversation(documentId?: string): Conversation;
  deleteConversation(conversationId: string): Promise<Result<void>>;
}

/**
 * Real chat service. Builds grounded context from the actual document,
 * streams responses from the backend AI provider, persists every message.
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

      const conversation = conversationId ? (await this.getConversation(conversationId)) : this.newConversation(context.documentId);
      const effectiveConversation = conversation ?? this.newConversation(context.documentId);

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
        await this.deps.provider.streamChat(request, {
          signal: options.signal,
          onDelta: (delta) => {
            full += delta;
            assistantMessage.content = full;
            assistantMessage.status = 'streaming';
            options.onDelta?.(delta);
          },
          onDone: async () => {
            assistantMessage.content = full;
            assistantMessage.status = 'complete';
            await this.deps.persistence.saveMessage(assistantMessage);
            options.onStatus?.('complete');
            this.publish(EventTopics.ASSISTANT_RESPONSE, { conversationId: effectiveConversation.id, message: assistantMessage });
          },
          onError: async (error) => {
            assistantMessage.status = 'error';
            assistantMessage.error = error.message;
            assistantMessage.content = full || error.message;
            await this.deps.persistence.saveMessage(assistantMessage);
            options.onStatus?.('error');
          },
        });
      } else {
        const response = await this.deps.provider.chat(request);
        assistantMessage.content = response.content;
        assistantMessage.status = 'complete';
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
      const conversation = await this.getConversation(conversationId);
      const effective = conversation ?? this.newConversation(context.documentId);
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
      };
      await this.deps.persistence.saveMessage(assistantMessage);
      this.publish(EventTopics.ASSISTANT_RESPONSE, { conversationId: effective.id, message: assistantMessage });
      return ok({ message: assistantMessage, conversation: effective });
    } catch (e) {
      return err(AppError.from(e));
    }
  }

  async research(
    conversationId: string,
    query: string,
    context: { documentId?: string },
  ): Promise<Result<ChatResult>> {
    try {
      const conversation = await this.getConversation(conversationId);
      const effective = conversation ?? this.newConversation(context.documentId);

      const userMessage: ChatMessage = {
        id: uuid(),
        conversationId: effective.id,
        role: 'user',
        content: `Research: ${query}`,
        createdAt: Date.now(),
        status: 'complete',
        documentId: context.documentId,
      };
      await this.deps.persistence.saveMessage(userMessage);

      const researchResult = await this.deps.provider.research(query);

      if (researchResult.mechanism === 'error' || researchResult.error) {
        const message = researchResult.error?.message ?? 'Research failed';
        const assistantMessage: ChatMessage = {
          id: uuid(),
          conversationId: effective.id,
          role: 'assistant',
          content: `I couldn't complete the research: ${message}`,
          createdAt: Date.now(),
          status: 'error',
          error: message,
          documentId: context.documentId,
        };
        await this.deps.persistence.saveMessage(assistantMessage);
        return ok({ message: assistantMessage, conversation: effective });
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

      let answerText: string;
      try {
        const ai = await this.deps.provider.chat(answerRequest);
        answerText = ai.content;
      } catch {
        // AI unavailable — still return the evidence so research is never faked.
        answerText = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n${s.relevantText.slice(0, 800)}`).join('\n\n');
      }

      const assistantMessage: ChatMessage = {
        id: uuid(),
        conversationId: effective.id,
        role: 'assistant',
        content: answerText,
        createdAt: Date.now(),
        status: 'complete',
        documentId: context.documentId,
        sources: sources.map((s) => ({ ...s, sourceId: s.sourceId })),
      };
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

  private async getConversation(conversationId: string): Promise<Conversation | undefined> {
    const list = await this.deps.persistence.listConversations();
    return list.find((c) => c.id === conversationId);
  }

  private async loadForPrompt(conversationId: string): Promise<{ role: 'system' | 'user' | 'assistant'; content: string }[]> {
    const messages = await this.deps.persistence.listMessages(conversationId);
    // Exclude streaming/error placeholders; keep last 16 real messages.
    return messages
      .filter((m) => m.status === 'complete' && m.content.trim())
      .slice(-16)
      .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.content }));
  }

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

    const chunks = retrieveChunks(doc, queryText, 4, 1500);
    const grounding: GroundingContext = {
      documentId,
      documentTitle: doc.title,
      pages: chunks.map((c) => ({ page: c.page, text: c.text })),
      selection,
    };
    const sections = chunks
      .map((c) => (c.sectionTitle ? { title: c.sectionTitle, text: c.text, page: c.page } : undefined))
      .filter((s): s is { title: string; text: string; page: number } => Boolean(s));
    if (sections.length > 0) grounding.sections = sections;
    if (doc.formulas.length > 0) grounding.formulas = doc.formulas.slice(0, 8).map((f) => ({ id: f.id, tex: f.tex, page: f.page }));
    if (doc.tables.length > 0) grounding.tables = doc.tables.slice(0, 4).map((t) => ({ id: t.id, page: t.page, rows: t.rows.map((r) => r.map((c) => c.text)) }));
    return grounding;
  }

  private publish(topic: string, payload: unknown): void {
    this.deps.eventBus.publish(topic, payload, 'client');
  }
}
