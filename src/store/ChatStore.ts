import { create } from 'zustand';
import type { IEventBus } from '@/events/types';
import type { ChatService } from '@/modules/chat/ChatService';
import type { AiActionIntent } from '@/modules/ai/AiProviderClient';
import type { ChatMessage, Conversation, ChatSource } from '@/modules/chat/ChatTypes';

export interface ChatState {
  conversations: Conversation[];
  activeConversationId?: string;
  messages: ChatMessage[];
  streaming: boolean;
  /** Sources/evidence attached to the latest assistant research message. */
  sources: ChatSource[];
  sending: boolean;
  error?: string;
  /** Live text of the in-flight streaming reply. */
  liveText: string;
  /** Live reasoning/thinking tokens of the in-flight streaming reply. */
  liveReasoning: string;
}

export interface ChatActions {
  init: () => Promise<void>;
  newConversation: (documentId?: string) => void;
  selectConversation: (conversationId: string) => Promise<void>;
  sendMessage: (content: string, context?: { documentId?: string; selection?: string }) => Promise<void>;
  runAction: (intent: AiActionIntent, context?: { documentId?: string; selection?: string }) => Promise<void>;
  regenerate: (context?: { documentId?: string; selection?: string }) => Promise<void>;
  followUp: (context?: { documentId?: string; selection?: string }) => Promise<void>;
  stop: () => void;
  research: (query: string, context?: { documentId?: string; url?: string }) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  clearError: () => void;
}

export type ChatStore = ChatState & ChatActions;

export interface CreateChatStoreOptions {
  service: ChatService;
  eventBus: IEventBus;
  initial?: Partial<ChatState>;
}

export function createChatStore({ service, eventBus, initial }: CreateChatStoreOptions) {
  let abortController: AbortController | undefined;

  const applyResult = async (result: Awaited<ReturnType<ChatService['sendMessage']>>, set: (fn: (s: ChatState) => Partial<ChatState>) => void, get: () => ChatStore) => {
    if (result.success && result.data) {
      const messages = await service.loadConversation(result.data.conversation.id);
      const conversations = await service.listConversations();
      set((s) => ({
        activeConversationId: result.data!.conversation.id,
        messages: messages.success && messages.data ? messages.data : s.messages,
        conversations: conversations.success && conversations.data ? conversations.data : s.conversations,
        sources: result.data!.sources ?? [],
        streaming: false,
        sending: false,
        liveText: '',
        liveReasoning: '',
        error: undefined,
      }));
    } else {
      set((s) => ({ sending: false, streaming: false, liveText: '', liveReasoning: '', error: result.error ?? 'Message failed' }));
    }
  };

  return create<ChatStore>((set, get) => ({
    conversations: [],
    messages: [],
    streaming: false,
    sources: [],
    sending: false,
    error: undefined,
    liveText: '',
    liveReasoning: '',
    ...initial,

    init: async () => {
      const result = await service.listConversations();
      if (result.success && result.data) {
        set({ conversations: result.data });
      }
    },

    newConversation: async (documentId) => {
      const conv = await service.createConversation(documentId);
      set({ activeConversationId: conv.id, messages: [], sources: [], error: undefined, liveText: '', liveReasoning: '' });
    },

    selectConversation: async (conversationId) => {
      const result = await service.loadConversation(conversationId);
      set({
        activeConversationId: conversationId,
        messages: result.success && result.data ? result.data : [],
        error: undefined,
        liveText: '',
        liveReasoning: '',
      });
    },

    sendMessage: async (content, context) => {
      if (!content.trim() || get().sending) return;
      abortController = new AbortController();
      const conversationId = get().activeConversationId;
      set({ sending: true, streaming: true, error: undefined, liveText: '' });
      const result = await service.sendMessage(conversationId, content, context ?? {}, {
        stream: true,
        signal: abortController.signal,
        onDelta: (delta) => {
          set((s) => ({ liveText: s.liveText + delta }));
        },
        onReasoningDelta: (delta) => {
          set((s) => ({ liveReasoning: s.liveReasoning + delta }));
        },
        onStatus: (status) => {
          set({ streaming: status === 'sending' || status === 'streaming' });
        },
      });
      await applyResult(result, set, get);
      eventBus.publish('chat.message_sent', { conversationId: result.success ? result.data?.conversation.id : undefined }, 'client');
    },

    runAction: async (intent, context) => {
      if (get().sending) return;
      abortController = new AbortController();
      const conversationId = get().activeConversationId;
      set({ sending: true, streaming: true, error: undefined, liveText: '' });
      const result = await service.runAction(conversationId ?? '', intent, context ?? {});
      await applyResult(result, set, get);
    },

    regenerate: async (context) => {
      const conversationId = get().activeConversationId;
      if (!conversationId || get().sending) return;
      abortController = new AbortController();
      set({ sending: true, streaming: true, error: undefined, liveText: '' });
      const result = await service.regenerate(conversationId, context ?? {}, {
        stream: true,
        signal: abortController.signal,
        onDelta: (delta) => {
          set((s) => ({ liveText: s.liveText + delta }));
        },
        onReasoningDelta: (delta) => {
          set((s) => ({ liveReasoning: s.liveReasoning + delta }));
        },
        onStatus: (status) => {
          set({ streaming: status === 'sending' || status === 'streaming' });
        },
      });
      await applyResult(result, set, get);
    },

    followUp: async (context) => {
      const conversationId = get().activeConversationId;
      if (!conversationId || get().sending) return;
      abortController = new AbortController();
      set({ sending: true, streaming: true, error: undefined, liveText: '' });
      const result = await service.followUp(conversationId, context ?? {}, {
        stream: true,
        signal: abortController.signal,
        onDelta: (delta) => {
          set((s) => ({ liveText: s.liveText + delta }));
        },
        onReasoningDelta: (delta) => {
          set((s) => ({ liveReasoning: s.liveReasoning + delta }));
        },
        onStatus: (status) => {
          set({ streaming: status === 'sending' || status === 'streaming' });
        },
      });
      await applyResult(result, set, get);
    },

    stop: () => {
      abortController?.abort();
      abortController = undefined;
      set({ streaming: false, sending: false, liveReasoning: '' });
    },

    research: async (query, context) => {
      if (get().sending) return;
      abortController = new AbortController();
      const conversationId = get().activeConversationId;
      set({ sending: true, streaming: true, error: undefined, liveText: '' });
      const result = await service.research(conversationId ?? '', query, {
        documentId: context?.documentId,
        url: context?.url,
      });
      if (result.success && result.data) {
        const messages = await service.loadConversation(result.data.conversation.id);
        set({
          activeConversationId: result.data.conversation.id,
          messages: messages.success && messages.data ? messages.data : [],
          sources: result.data.sources ?? [],
          streaming: false,
          sending: false,
          liveText: '',
          liveReasoning: '',
          error: undefined,
        });
      } else {
        set({ sending: false, streaming: false, liveText: '', liveReasoning: '', error: result.error ?? 'Research failed' });
      }
    },

    deleteConversation: async (conversationId) => {
      await service.deleteConversation(conversationId);
      const state = get();
      set({
        conversations: state.conversations.filter((c) => c.id !== conversationId),
        activeConversationId: state.activeConversationId === conversationId ? undefined : state.activeConversationId,
        messages: state.activeConversationId === conversationId ? [] : state.messages,
        liveText: '',
        liveReasoning: '',
      });
    },

    clearError: () => set({ error: undefined }),
  }));
}

export type { ChatMessage, Conversation, ChatSource };
