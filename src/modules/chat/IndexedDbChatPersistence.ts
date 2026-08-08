import { get, set, del, keys, createStore } from 'idb-keyval';
import { ok, err } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import type { ChatMessage, ChatPersistence, Conversation } from './ChatTypes';

const store = createStore('ai-learning-os-chat', 'chat');

const MSG_KEY = (id: string) => `message:${id}`;
const CONV_KEY = (id: string) => `conversation:${id}`;
const CONV_LIST_KEY = 'conversations';

export class IndexedDbChatPersistence implements ChatPersistence {
  async saveMessage(message: ChatMessage): Promise<void> {
    await set(MSG_KEY(message.id), message, store);
    // Touch conversation timestamp.
    const conv = await get<Conversation>(CONV_KEY(message.conversationId), store);
    if (conv) {
      conv.updatedAt = Date.now();
      await set(CONV_KEY(message.conversationId), conv, store);
      await this.refreshConversationList(conv);
    }
  }

  async listMessages(conversationId: string): Promise<ChatMessage[]> {
    const allKeys = await keys(store);
    const messageKeys = allKeys.filter((k): k is string => typeof k === 'string' && k.startsWith('message:'));
    const messages: ChatMessage[] = [];
    for (const k of messageKeys) {
      const msg = await get<ChatMessage>(k, store);
      if (msg && msg.conversationId === conversationId) messages.push(msg);
    }
    return messages.sort((a, b) => a.createdAt - b.createdAt);
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    await set(CONV_KEY(conversation.id), conversation, store);
    await this.refreshConversationList(conversation);
  }

  async listConversations(): Promise<Conversation[]> {
    const list = await get<Conversation[]>(CONV_LIST_KEY, store);
    return list ?? [];
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const allKeys = await keys(store);
    await Promise.all(
      allKeys
        .filter((k): k is string => (typeof k === 'string' && k.startsWith('message:')) || k === CONV_KEY(conversationId))
        .map((k) => del(k, store)),
    );
    const list = await this.listConversations();
    await set(CONV_LIST_KEY, list.filter((c) => c.id !== conversationId), store);
  }

  private async refreshConversationList(conversation: Conversation): Promise<void> {
    const list = await this.listConversations();
    const next = [conversation, ...list.filter((c) => c.id !== conversation.id)].sort((a, b) => b.updatedAt - a.updatedAt);
    await set(CONV_LIST_KEY, next, store);
  }
}

export { ok as chatOk, err as chatErr };
export type { Result };
