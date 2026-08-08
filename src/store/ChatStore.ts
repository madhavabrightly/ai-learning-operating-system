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
}

export interface ChatActions {
  init: () => Promise<void>;
  newConversation: (documentId?: string) => void;
  selectConversation: (conversationId: string) => Promise<void>;
  sendMessage: (content: string, context?: { documentId?: string; selection?: string }) => Promise<void>;
  runAction: (intent: AiActionIntent, context?: { documentId?: string; selection?: string }) => Promise<void>;
  research: (query: string, context?: { documentId?: string }) => Promise<void>;
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
  return create<ChatStore>((set, get) => ({
    conversations: [],
    messages: [],
    streaming: false,
    sources: [],
    sending: false,
    error: undefined,
    ...initial,

    init: async () => {
      const result = await service.listConversations();
      if (result.success && result.data) {
        set({ conversations: result.data });
      }
    },

    newConversation: async (documentId) => {
      const conv = await service.createConversation(documentId);
      set({ activeConversationId: conv.id, messages: [], sources: [], error: undefined });
    },

    selectConversation: async (conversationId) => {
      const result = await service.loadConversation(conversationId);
      set({
        activeConversationId: conversationId,
        messages: result.success && result.data ? result.data : [],
        error: undefined,
      });
    },

    sendMessage: async (content, context) => {
      if (!content.trim()) return;
      const conversationId = get().activeConversationId;
      set({ sending: true, error: undefined });
      const result = await service.sendMessage(conversationId, content, context ?? {}, {
        stream: true,
        onDelta: () => {
          // Streaming content is applied via onStatus polling below; we reload
          // messages from the store after completion for simplicity.
        },
        onStatus: (status) => {
          set({ streaming: status === 'sending' || status === 'streaming' });
        },
      });
      if (result.success && result.data) {
        const messages = await service.loadConversation(result.data.conversation.id);
        const conversations = await service.listConversations();
        set({
          activeConversationId: result.data.conversation.id,
          messages: messages.success && messages.data ? messages.data : [],
          conversations: conversations.success && conversations.data ? conversations.data : get().conversations,
          sources: result.data.sources ?? [],
          streaming: false,
          sending: false,
        });
        eventBus.publish('chat.message_sent', { conversationId: result.data.conversation.id }, 'client');
      } else {
        set({ sending: false, streaming: false, error: result.error ?? 'Message failed' });
      }
    },

    runAction: async (intent, context) => {
      const conversationId = get().activeConversationId;
      set({ sending: true, error: undefined });
      const result = await service.runAction(conversationId ?? '', intent, context ?? {});
      if (result.success && result.data) {
        const messages = await service.loadConversation(result.data.conversation.id);
        set({
          activeConversationId: result.data.conversation.id,
          messages: messages.success && messages.data ? messages.data : [],
          sending: false,
        });
      } else {
        set({ sending: false, error: result.error ?? 'Action failed' });
      }
    },

    research: async (query, context) => {
      const conversationId = get().activeConversationId;
      set({ sending: true, error: undefined });
      const result = await service.research(conversationId ?? '', query, context ?? {});
      if (result.success && result.data) {
        const messages = await service.loadConversation(result.data.conversation.id);
        set({
          activeConversationId: result.data.conversation.id,
          messages: messages.success && messages.data ? messages.data : [],
          sources: result.data.sources ?? [],
          sending: false,
        });
      } else {
        set({ sending: false, error: result.error ?? 'Research failed' });
      }
    },

    deleteConversation: async (conversationId) => {
      await service.deleteConversation(conversationId);
      const state = get();
      set({
        conversations: state.conversations.filter((c) => c.id !== conversationId),
        activeConversationId: state.activeConversationId === conversationId ? undefined : state.activeConversationId,
        messages: state.activeConversationId === conversationId ? [] : state.messages,
      });
    },

    clearError: () => set({ error: undefined }),
  }));
}

export type { ChatMessage, Conversation, ChatSource };
