import { create } from 'zustand';
import type { IEventBus } from '@/events/types';
import { EventTopics } from '@/events/EventTopics';
import type { IDocumentService } from '@/modules/document/types/DocumentTypes';
import type { DocumentReference, DocumentPage, DocumentStructure, DocumentQuality, DocumentSelection } from '@/modules/document/types/DocumentTypes';
import type { ParsedDocument } from '@/modules/document/model/DocumentModel';
import type { WorkspaceContextState } from '@/modules/workspace/types/WorkspaceTypes';

export interface WebPageSource {
  url: string;
  title: string;
  text: string;
}

export interface DocumentState {
  documents: DocumentReference[];
  currentDocumentId?: string;
  currentDocument?: ParsedDocument;
  pages: DocumentPage[];
  structure?: DocumentStructure;
  quality?: DocumentQuality;
  page: number;
  zoom: number;
  searchResults: DocumentSelection[];
  selection?: WorkspaceContextState['selection'];
  loading: boolean;
  error?: string;
}

export interface DocumentActions {
  list: () => Promise<DocumentReference[]>;
  upload: (file: File) => Promise<DocumentReference | undefined>;
  open: (documentId: string) => Promise<DocumentReference | undefined>;
  delete: (documentId: string) => Promise<void>;
  setPage: (page: number) => void;
  setZoom: (zoom: number) => void;
  setSelection: (selection: WorkspaceContextState['selection']) => void;
  search: (query: string) => Promise<void>;
  injectWebPage: (source: WebPageSource) => void;
  clearError: () => void;
}

export type DocumentStore = DocumentState & DocumentActions;

export interface CreateDocumentStoreOptions {
  service: IDocumentService;
  eventBus: IEventBus;
  initial?: Partial<DocumentState>;
}

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

    list: async () => {
      const state = get();
      return state.documents;
    },

    upload: async (file) => {
      set({ loading: true, error: undefined });
      const result = await service.upload(file);
      if (result.success && result.data) {
        set((state) => ({
          documents: [...state.documents, result.data as DocumentReference],
          currentDocumentId: result.data?.id,
          loading: false,
        }));
        await get().open(result.data.id);
        return result.data;
      }
      set({ loading: false, error: result.error ?? 'Upload failed' });
      return undefined;
    },

    open: async (documentId) => {
      set({ loading: true, error: undefined });
      const refResult = await service.open(documentId);
      if (!refResult.success || !refResult.data) {
        set({ loading: false, error: refResult.error ?? 'Open failed' });
        return undefined;
      }
      const [pagesResult, structureResult, qualityResult] = await Promise.all([
        service.getPages(documentId),
        service.getStructure(documentId),
        service.getQuality(documentId),
      ]);
      set({
        currentDocumentId: documentId,
        currentDocument: refResult.data as unknown as ParsedDocument,
        pages: pagesResult.success && pagesResult.data ? pagesResult.data : [],
        structure: structureResult.success && structureResult.data ? structureResult.data : undefined,
        quality: qualityResult.success && qualityResult.data ? qualityResult.data : undefined,
        page: 1,
        loading: false,
      });
      eventBus.publish(EventTopics.DOCUMENT_OPENED, { documentId, title: refResult.data.title }, 'client');
      return refResult.data;
    },

    delete: async (documentId) => {
      const state = get();
      await service.close(documentId);
      set({
        documents: state.documents.filter((d) => d.id !== documentId),
        currentDocumentId: state.currentDocumentId === documentId ? undefined : state.currentDocumentId,
        currentDocument: state.currentDocumentId === documentId ? undefined : state.currentDocument,
        pages: state.currentDocumentId === documentId ? [] : state.pages,
        searchResults: state.currentDocumentId === documentId ? [] : state.searchResults,
      });
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

    injectWebPage: (source) => {
      const state = get();
      const documentId = state.currentDocumentId ?? `doc-web-${Date.now()}`;
      const nextIndex = state.pages.length + 1;
      const page: DocumentPage = {
        index: nextIndex,
        text: `Source: ${source.url}\nTitle: ${source.title}\n\n${source.text}`,
        blocks: [
          { type: 'heading', x: 40, y: 60, width: 400, height: 30, text: source.title },
          { type: 'text', x: 40, y: 110, width: 500, height: 200, text: source.text },
        ],
      };

      let documents = state.documents;
      const exists = documents.some((d) => d.id === documentId);
      if (!exists) {
        const ref: DocumentReference = {
          id: documentId,
          title: `Web: ${source.title}`,
          source: source.url,
          mimeType: 'text/html',
          uploadedAt: Date.now(),
        };
        documents = [...documents, ref];
      }

      set({
        documents,
        currentDocumentId: documentId,
        pages: [...state.pages, page],
        page: nextIndex,
      });
      eventBus.publish(EventTopics.DOCUMENT_OPENED, { documentId, title: source.title, source: source.url }, 'client');
    },

    clearError: () => set({ error: undefined }),
  }));
}
