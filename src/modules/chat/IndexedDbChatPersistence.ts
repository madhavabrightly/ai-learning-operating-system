import { ok, err } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import type { ChatPersistence, ChatMessage, Conversation } from './ChatTypes';

const DB_NAME = 'aios-chat';
const DB_VERSION = 1;
const CONVERSATIONS_STORE = 'conversations';
const MESSAGES_STORE = 'messages';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
        db.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        const store = db.createObjectStore(MESSAGES_STORE, { keyPath: 'id' });
        store.createIndex('conversationId', 'conversationId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class IndexedDbChatPersistence implements ChatPersistence {
  private async withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
    const db = await openDb();
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    await this.withDb(async (db) => {
      const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
      tx.objectStore(CONVERSATIONS_STORE).put(conversation);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  async saveMessage(message: ChatMessage): Promise<void> {
    await this.withDb(async (db) => {
      const tx = db.transaction(MESSAGES_STORE, 'readwrite');
      tx.objectStore(MESSAGES_STORE).put(message);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
  }

  async listConversations(): Promise<Conversation[]> {
    return this.withDb(async (db) => {
      const tx = db.transaction(CONVERSATIONS_STORE, 'readonly');
      const store = tx.objectStore(CONVERSATIONS_STORE);
      return new Promise<Conversation[]>((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => reject(request.error);
      });
    });
  }

  async listMessages(conversationId: string): Promise<ChatMessage[]> {
    return this.withDb(async (db) => {
      const tx = db.transaction(MESSAGES_STORE, 'readonly');
      const index = tx.objectStore(MESSAGES_STORE).index('conversationId');
      return new Promise<ChatMessage[]>((resolve, reject) => {
        const request = index.getAll(conversationId);
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => reject(request.error);
      });
    });
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.withDb(async (db) => {
      const tx = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE], 'readwrite');
      tx.objectStore(CONVERSATIONS_STORE).delete(conversationId);
      const index = tx.objectStore(MESSAGES_STORE).index('conversationId');
      const request = index.openCursor(conversationId);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
  }
}