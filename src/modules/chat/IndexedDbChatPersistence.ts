import type { ChatPersistence, ChatMessage, Conversation } from './ChatTypes';

const DB_NAME = 'aios-chat';
// v2: conversations/messages persisted by the earlier mock/demo build (stale
// "Binary Search" demo threads) are purged on upgrade so they can't resurface
// in the chat sidebar.
const DB_VERSION = 2;
const CONVERSATIONS_STORE = 'conversations';
const MESSAGES_STORE = 'messages';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // Purge legacy stores written by the pre-parser (mock/demo) build so
      // stale demo conversations can never be restored into the chat list.
      if (event.oldVersion < 2) {
        for (const name of [CONVERSATIONS_STORE, MESSAGES_STORE]) {
          if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
        }
      }
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

  async getConversation(conversationId: string): Promise<Conversation | undefined> {
    return this.withDb(async (db) => {
      const tx = db.transaction(CONVERSATIONS_STORE, 'readonly');
      const store = tx.objectStore(CONVERSATIONS_STORE);
      return new Promise<Conversation | undefined>((resolve, reject) => {
        const request = store.get(conversationId);
        request.onsuccess = () => resolve(request.result as Conversation | undefined);
        request.onerror = () => reject(request.error);
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

  async deleteMessage(messageId: string): Promise<void> {
    await this.withDb(async (db) => {
      const tx = db.transaction(MESSAGES_STORE, 'readwrite');
      tx.objectStore(MESSAGES_STORE).delete(messageId);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
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