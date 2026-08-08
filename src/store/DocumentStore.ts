import { create } from 'zustand';
import type { IEventBus } from '@/events/types';
import { EventTopics } from '@/events/EventTopics';
import type { DocumentService } from '@/modules/document/service/DocumentService';
import type {
  DocumentSelection,
  ParsedDocument,
  DocumentPage,
} from '@/modules/document/model/DocumentModel';
import type { WorkspaceContextState } from '@/modules/workspace/types/WorkspaceTypes';

export interface WebPageSource {
  url: string;
  title: string;
  text: string;
}

export interface DocumentState {
  documents: ParsedDocument[];
  currentDocumentId?: string;
  currentDocument?: ParsedDocument;
  pages: DocumentPage[];
  page: number;
  zoom: number;
  searchResults: DocumentSelection[];
  selection?: WorkspaceContextState['selection'];
  processing?: ParsedDocument['processing'];
  loading: boolean;
  error?: string;
}

export interface DocumentActions {
  upload: (file: File) => Promise<ParsedDocument | undefined>;
  open: (documentId: string) => Promise<ParsedDocument | undefined>;
  setPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  setSelection: (selection: WorkspaceContextState['selection']) => void;
  search: (query: string) => Promise<void>;
  injectWebPage: (source: WebPageSource) => Promise<void>;
  list: () => Promise<void>;
  delete: (documentId: string) => Promise<void>;
  refreshProcessing: () => Promise<void>;
  clearError: () => void;
}

export type DocumentStore = DocumentState & DocumentActions;

export interface CreateDocumentStoreOptions {
  service: DocumentService;
  eventBus: IEventBus;
  initial?: Partial<DocumentState>;
}

/**
 * Real document store. Backed by the real DocumentService (which persists to
 * IndexedDB). Pages, structure, quality and search results all come from the
 * actual parsed document — never fabricated.
 */
export function createDocumentStore({ service, eventBus, initial }: CreateDocumentStoreOptions) {
  return create<DocumentStore>((set, get) => ({
    documents: [],
    pages: [],
    page: 1,
    zoom: 1,
    searchResults: [],
    loading: false,
    error: undefined,
    ...initial,

    upload: async (file) => {
      set({ loading: true, error: undefined });
      const result = await service.upload(file);
      if (result.success && result.data) {
        const doc = result.data;
        set((state) => ({
          documents: upsertDocument(state.documents, doc),
          currentDocumentId: doc.id,
          loading: false,
          error: undefined,
        }));
        await get().open(doc.id);
        return doc;
      }
      set({ loading: false, error: result.error ?? 'Upload failed' });
      return undefined;
    },

    open: async (documentId) => {
      set({ loading: true, error: undefined });
      const result = await service.open(documentId);
      if (!result.success || !result.data) {
        set({ loading: false, error: result.error ?? 'Open failed' });
        return undefined;
      }
      const doc = result.data;
      set({
        currentDocumentId: documentId,
        currentDocument: doc,
        pages: doc.pages,
        page: Math.min(get().page, Math.max(1, doc.metadata.pageCount)),
        searchResults: [],
        loading: false,
        error: undefined,
      });
      eventBus.publish(EventTopics.DOCUMENT_OPENED, { documentId, title: doc.title }, 'client');
      return doc;
    },

    setPage: (page) => {
      const documentId = get().currentDocumentId;
      if (documentId) service.setPage(documentId, page);
      set({ page });
    },

    setZoom: (zoom) => {
      const documentId = get().currentDocumentId;
      if (documentId) service.setZoom(documentId, zoom);
      set({ zoom });
    },

    setSelection: (selection) => {
      const documentId = get().currentDocumentId;
      const page = get().page;
      if (documentId && selection?.text) {
        eventBus.publish(EventTopics.DOCUMENT_SELECTED_TEXT_CHANGED, { documentId, page, text: selection.text }, 'client');
      }
      set({ selection });
    },

    search: async (query) => {
      const documentId = get().currentDocumentId;
      if (!documentId) return;
      const result = await service.search(documentId, query);
      set({ searchResults: result.success && result.data ? result.data : [] });
      eventBus.publish(EventTopics.DOCUMENT_SEARCH, { documentId, query, count: get().searchResults.length }, 'client');
    },

    injectWebPage: async (source) => {
      // Web pages injected into a document keep provenance (URL + title).
      const documentId = get().currentDocumentId ?? `doc-web-${Date.now()}`;
      const current = get().currentDocument;
      if (!current) return;
      const nextPage: DocumentPage = {
        index: current.pages.length + 1,
        text: `Source: ${source.url}\nTitle: ${source.title}\n\n${source.text}`,
        blocks: [
          { id: `${documentId}-web-heading`, type: 'heading', text: source.title, headingLevel: 1, source: { page: current.pages.length + 1 } },
          { id: `${documentId}-web-text`, type: 'text', text: source.text, source: { page: current.pages.length + 1 } },
        ],
        blockIds: [],
      };
      const updated: ParsedDocument = {
        ...current,
        pages: [...current.pages, nextPage],
        metadata: { ...current.metadata, pageCount: current.pages.length + 1 },
      };
      set({
        currentDocument: updated,
        pages: updated.pages,
        page: updated.pages.length,
      });
      eventBus.publish(EventTopics.DOCUMENT_OPENED, { documentId, title: source.title, source: source.url }, 'client');
    },

    list: async () => {
      const result = await service.listDocuments();
      set({ documents: result.success && result.data ? result.data : [] });
    },

    delete: async (documentId) => {
      await service.deleteDocument(documentId);
      const state = get();
      const next = state.documents.filter((d) => d.id !== documentId);
      set({
        documents: next,
        currentDocumentId: state.currentDocumentId === documentId ? undefined : state.currentDocumentId,
        currentDocument: state.currentDocumentId === documentId ? undefined : state.currentDocument,
        pages: state.currentDocumentId === documentId ? [] : state.pages,
      });
    },

    refreshProcessing: async () => {
      const documentId = get().currentDocumentId;
      if (!documentId) return;
      const result = await service.getProcessingRecord(documentId);
      set({ processing: result.success && result.data ? result.data : undefined });
    },

    clearError: () => set({ error: undefined }),
  }));
}

function upsertDocument(list: ParsedDocument[], doc: ParsedDocument): ParsedDocument[] {
  const idx = list.findIndex((d) => d.id === doc.id);
  if (idx === -1) return [doc, ...list];
  const next = [...list];
  next[idx] = doc;
  return next;
}
