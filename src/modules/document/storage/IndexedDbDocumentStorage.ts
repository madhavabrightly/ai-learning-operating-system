import { get, set, del, keys, createStore } from 'idb-keyval';
import { ok, err, fromPromise } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import { AppError } from '@/errors/AppError';
import type { IDocumentStorage, ParsedDocument } from '../model/DocumentModel';

// Dedicated IndexedDB store so document payloads never collide with cache keys.
// Distinct DB name per subsystem (idb-keyval only creates the object store on
// first open of a fresh DB — sharing a DB name between subsystems breaks the
// store that opens second).
const store = createStore('ai-learning-os-documents', 'documents');

const FILE_KEY = (id: string) => `file:${id}`;
const PARSED_KEY = (id: string) => `parsed:${id}`;
const META_KEY = 'document-list';

export interface StoredFile {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  data: ArrayBuffer;
}

export interface DocumentListEntry {
  id: string;
  title: string;
  uploadedAt: number;
  status: ParsedDocument['status'];
  format: ParsedDocument['metadata']['format'];
}

/** IndexedDB-backed real document persistence. */
export class IndexedDbDocumentStorage implements IDocumentStorage {
  readonly name = 'indexeddb-documents';

  async saveFile(documentId: string, file: File): Promise<Result<void>> {
    if (!file) return err('No file provided');
    const data = await file.arrayBuffer();
    const stored: StoredFile = {
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      data,
    };
    const saved = await fromPromise(() => set(FILE_KEY(documentId), stored, store), { retryable: false });
    if (!saved.success) return saved;

    // Update the document list metadata.
    const list = (await this.listDocuments()).data ?? [];
    const entry: DocumentListEntry = {
      id: documentId,
      title: file.name,
      uploadedAt: Date.now(),
      status: 'UPLOADING',
      format: detectFormatFromFile(file),
    };
    const next = [entry, ...list.filter((e) => e.id !== documentId)];
    await set(META_KEY, next, store);
    return ok(undefined);
  }

  async getFile(documentId: string): Promise<Result<File>> {
    const result = await fromPromise<StoredFile | undefined>(() => get<StoredFile>(FILE_KEY(documentId), store), { retryable: false });
    if (!result.success) return err(result.error ?? 'Failed to read file');
    const stored = result.data;
    if (!stored) return err(`No stored file for ${documentId}`);
    const blob = new Blob([stored.data], { type: stored.type });
    const file = new File([blob], stored.name, { type: stored.type, lastModified: stored.lastModified });
    return ok(file);
  }

  async saveParsed(document: ParsedDocument): Promise<Result<void>> {
    if (!document?.id) return err('Invalid document');
    const saved = await fromPromise(() => set(PARSED_KEY(document.id), document, store), { retryable: false });
    if (!saved.success) return saved;

    // Update list metadata with status/format.
    const list = (await this.listEntries()).data ?? [];
    const entry = list.find((e) => e.id === document.id);
    if (entry) {
      entry.status = document.status;
      entry.format = document.metadata.format;
      await set(META_KEY, list, store);
    }
    return ok(undefined);
  }

  async getParsed(documentId: string): Promise<Result<ParsedDocument | undefined>> {
    const result = await fromPromise<ParsedDocument | undefined>(() => get<ParsedDocument>(PARSED_KEY(documentId), store), { retryable: false });
    if (!result.success) return err(result.error ?? 'Failed to read parsed document');
    return ok(result.data);
  }

  async listDocuments(): Promise<Result<ParsedDocument[]>> {
    return fromPromise(async () => {
      const list = await get<DocumentListEntry[]>(META_KEY, store);
      if (!list) return [];
      const docs: ParsedDocument[] = [];
      for (const entry of list) {
        const parsed = await get<ParsedDocument>(PARSED_KEY(entry.id), store);
        if (parsed) docs.push(parsed);
      }
      return docs;
    }, { retryable: false });
  }

  /** List lightweight document metadata without loading full payloads. */
  async listEntries(): Promise<Result<DocumentListEntry[]>> {
    return fromPromise(async () => {
      const list = await get<DocumentListEntry[]>(META_KEY, store);
      return list ?? [];
    }, { retryable: false });
  }

  async deleteDocument(documentId: string): Promise<Result<void>> {
    await Promise.all([del(FILE_KEY(documentId), store), del(PARSED_KEY(documentId), store)]);
    const list = (await this.listDocuments()).data ?? [];
    await set(META_KEY, list.filter((e) => e.id !== documentId), store);
    return ok(undefined);
  }

  /** List all keys (used by SessionEngine for scanning). */
  async keys(): Promise<string[]> {
    try {
      return await keys(store);
    } catch (e) {
      throw AppError.from(e);
    }
  }

  /** Delete all stored documents. */
  async clearAll(): Promise<Result<void>> {
    const allKeys = await keys(store);
    await Promise.all(allKeys.map((k) => del(k, store)));
    return ok(undefined);
  }
}

function detectFormatFromFile(file: File): ParsedDocument['metadata']['format'] {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  if (name.endsWith('.txt') || file.type.startsWith('text/')) return 'txt';
  return 'unsupported';
}
