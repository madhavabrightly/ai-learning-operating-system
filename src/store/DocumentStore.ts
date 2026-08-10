import { create } from 'zustand';
import type { IEventBus } from '@/events/types';
import { EventTopics } from '@/events/EventTopics';
import type { IDocumentService } from '@/modules/document/types/DocumentTypes';
import type { DocumentReference, DocumentPage as ServiceDocumentPage, DocumentStructure, DocumentQuality, DocumentSelection } from '@/modules/document/types/DocumentTypes';
import type { ParsedDocument } from '@/modules/document/model/DocumentModel';
import type { WorkspaceContextState } from '@/modules/workspace/types/WorkspaceTypes';
import { createEmptyProcessingRecord } from '@/modules/document/model/DocumentModel';

export interface WebPageSource {
  url: string;
  title: string;
  text: string;
}

export interface DocumentState {
  documents: DocumentReference[];
  currentDocumentId?: string;
  currentDocument?: ParsedDocument;
  pages: ServiceDocumentPage[];
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
      const pages = pagesResult.success && pagesResult.data ? pagesResult.data : [];
      const structure = structureResult.success && structureResult.data ? structureResult.data : undefined;
      const quality = qualityResult.success && qualityResult.data ? qualityResult.data : undefined;
      set({
        currentDocumentId: documentId,
        currentDocument: toParsedDocument(refResult.data, pages, structure, quality),
        pages,
        structure,
        quality,
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
      const page: ServiceDocumentPage = {
        index: nextIndex,
        text: `Source: ${source.url}\nTitle: ${source.title}\n\n${source.text}`,
        blocks: [
          { type: 'heading', x: 40, y: 60, width: 400, height: 30, text: source.title },
          { type: 'text', x: 40, y: 110, width: 500, height: 200, text: source.text },
        ],
      };

      let documents = state.documents;
      let ref: DocumentReference;
      const exists = documents.some((d) => d.id === documentId);
      if (!exists) {
        ref = {
          id: documentId,
          title: `Web: ${source.title}`,
          source: source.url,
          mimeType: 'text/html',
          uploadedAt: Date.now(),
        };
        documents = [...documents, ref];
      } else {
        ref = documents.find((d) => d.id === documentId) as DocumentReference;
      }

      const pages = [...state.pages, page];
      set({
        documents,
        currentDocumentId: documentId,
        currentDocument: toParsedDocument(ref, pages, undefined, undefined),
        pages,
        page: nextIndex,
      });
      eventBus.publish(EventTopics.DOCUMENT_OPENED, { documentId, title: source.title, source: source.url }, 'client');
    },

    clearError: () => set({ error: undefined }),
  }));
}

// ---------------------------------------------------------------------------
// Build a well-formed ParsedDocument from the service-layer pieces so the
// UI (DocumentViewer etc.) never sees a Partial<ParsedDocument> with
// undefined pages / formulas / tables / figures.
// ---------------------------------------------------------------------------
function toParsedDocument(
  ref: DocumentReference,
  pages: ServiceDocumentPage[],
  structure: DocumentStructure | undefined,
  quality: DocumentQuality | undefined,
): ParsedDocument {
  const modelPages: ParsedDocument['pages'] = pages.map((p) => ({
    index: p.index,
    text: p.text ?? '',
    blocks: (p.blocks ?? []).map((b, i) => ({
      id: `b-${p.index}-${i}`,
      type: b.type === 'image' ? ('figure' as const) : (b.type as ParsedDocument['pages'][number]['blocks'][number]['type']),
      text: b.text,
      source: {
        page: p.index,
        bbox: b.x !== undefined ? { x: b.x, y: b.y, width: b.width, height: b.height } : undefined,
        confidence: b.confidence,
      },
    })),
    blockIds: [],
    needsOcr: !p.text && (p.blocks ?? []).length === 0,
  }));
  const ocrRequired = modelPages.some((p) => p.needsOcr);
  const formatName = (ref.mimeType ?? '').toLowerCase();
  const format: ParsedDocument['metadata']['format'] = formatName.includes('pdf')
    ? 'pdf'
    : formatName.includes('html')
      ? 'html'
      : formatName.startsWith('text/')
        ? 'txt'
        : formatName.includes('docx')
          ? 'docx'
          : 'unknown';
  return {
    id: ref.id,
    title: ref.title,
    metadata: {
      format,
      title: ref.title,
      pageCount: ref.pageCount ?? pages.length,
      wordCount: pages.reduce((s, p) => s + (p.text?.split(/\s+/).filter(Boolean).length ?? 0), 0),
      contentHash: '',
      sizeBytes: 0,
      parserEngine: 'aios',
      requiresOcr: ocrRequired,
      ocrStatus: ocrRequired ? 'required' : 'not_required',
    },
    pages: modelPages,
    sections: [],
    formulas: (structure?.formulas ?? []).map((f) => ({
      id: f.id,
      page: f.page,
      tex: f.tex,
      inline: f.inline,
      confidence: f.confidence,
      source: f.bbox ? { page: f.page, bbox: f.bbox } : { page: f.page },
    })),
    tables: (structure?.tables ?? []).map((t) => ({
      id: t.id,
      page: t.page,
      caption: undefined,
      headers: t.rows.length > 0 ? t.rows[0] : [],
      rows: t.rows.slice(1).map((row) => row.map((cell) => ({ text: cell }))),
      reduced: false,
      confidence: t.confidence,
      bbox: t.bbox,
      source: { page: t.page, bbox: t.bbox },
    })),
    figures: (structure?.figures ?? []).map((f) => ({
      id: f.id,
      page: f.page,
      caption: f.caption,
      confidence: f.confidence,
      bbox: f.bbox,
      imageUrl: undefined,
      hasImage: false,
      source: { page: f.page, bbox: f.bbox },
    })),
    citations: [],
    index: [],
    status: quality ? 'READY' : 'PROCESSING',
    processing: createEmptyProcessingRecord(ref.id),
    createdAt: ref.uploadedAt ?? Date.now(),
  } as ParsedDocument;
}
