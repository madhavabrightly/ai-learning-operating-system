const DB_NAME = 'aios-documents';
const DB_VERSION = 1;
const PAGES_STORE = 'pages';
const STRUCTURE_STORE = 'structure';

import type { DocumentPage, DocumentStructure } from '../types/DocumentTypes';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PAGES_STORE)) {
        db.createObjectStore(PAGES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STRUCTURE_STORE)) {
        db.createObjectStore(STRUCTURE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class IndexedDbDocumentStorage {
  async savePages(documentId: string, pages: DocumentPage[]): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction(PAGES_STORE, 'readwrite');
      tx.objectStore(PAGES_STORE).put({ id: documentId, pages });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async loadPages(documentId: string): Promise<DocumentPage[]> {
    const db = await openDb();
    try {
      const tx = db.transaction(PAGES_STORE, 'readonly');
      return new Promise<DocumentPage[]>((resolve, reject) => {
        const request = tx.objectStore(PAGES_STORE).get(documentId);
        request.onsuccess = () => resolve((request.result as { pages?: DocumentPage[] })?.pages ?? []);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  async saveStructure(documentId: string, structure: DocumentStructure): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction(STRUCTURE_STORE, 'readwrite');
      tx.objectStore(STRUCTURE_STORE).put({ id: documentId, structure });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async loadStructure(documentId: string): Promise<DocumentStructure | undefined> {
    const db = await openDb();
    try {
      const tx = db.transaction(STRUCTURE_STORE, 'readonly');
      return new Promise<DocumentStructure | undefined>((resolve, reject) => {
        const request = tx.objectStore(STRUCTURE_STORE).get(documentId);
        request.onsuccess = () => resolve((request.result as { structure?: DocumentStructure })?.structure);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  async delete(documentId: string): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction([PAGES_STORE, STRUCTURE_STORE], 'readwrite');
      tx.objectStore(PAGES_STORE).delete(documentId);
      tx.objectStore(STRUCTURE_STORE).delete(documentId);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
}