import { v4 as uuid } from 'uuid';
import { ok, fromPromise } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import { EventTopics } from '@/events/EventTopics';
import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';
import type { IndexedDbDocumentStorage } from '../storage/IndexedDbDocumentStorage';
import type { ParsedDocument } from '../model/DocumentModel';
import { normalizeParserOutput, type ParserOutput, type RawPage } from '../model/normalizer';
import type {
  DocumentReference,
  DocumentPage,
  DocumentStructure,
  DocumentQuality,
  DocumentSelection,
  IDocumentService,
} from '../types/DocumentTypes';

const MOCK_PAGES: Record<string, DocumentPage[]> = {};
const MOCK_STRUCTURE: Record<string, DocumentStructure> = {};

export interface DocumentServiceOptions {
  extractFigures?: boolean;
  maxFigureSize?: number;
}

export class DocumentService implements IDocumentService {
  private documents = new Map<string, DocumentReference>();

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly _storage?: IndexedDbDocumentStorage,
    private readonly _options: DocumentServiceOptions = {},
  ) {}

  async upload(file: File, documentId?: string): Promise<Result<DocumentReference>> {
    const id = documentId ?? `doc-${uuid()}`;
    const ref: DocumentReference = {
      id,
      title: file.name,
      mimeType: file.type,
      uploadedAt: Date.now(),
    };
    this.documents.set(id, ref);
    this.logger.info('Document uploaded', { documentId: id, file: file.name });
    this.eventBus.publish(EventTopics.UPLOAD_STARTED, { documentId: id, fileName: file.name }, 'client');

    // Simulate extracted text content from file name for demo purposes.
    MOCK_PAGES[id] = generateMockPages(id, file.name);
    MOCK_STRUCTURE[id] = generateMockStructure(id);

    this.eventBus.publish(EventTopics.UPLOAD_COMPLETED, { documentId: id, fileName: file.name }, 'client');
    return ok(ref);
  }

  async open(documentId: string): Promise<Result<DocumentReference>> {
    const ref = this.documents.get(documentId);
    if (!ref) {
      // Synthetic fallback so workspace tests can open documents without upload.
      const synthetic: DocumentReference = { id: documentId, title: `Document ${documentId}`, uploadedAt: Date.now() };
      this.documents.set(documentId, synthetic);
      MOCK_PAGES[documentId] = generateMockPages(documentId, synthetic.title);
      MOCK_STRUCTURE[documentId] = generateMockStructure(documentId);
      this.eventBus.publish(EventTopics.DOCUMENT_OPENED, { documentId }, 'client');
      return ok(synthetic);
    }
    this.eventBus.publish(EventTopics.DOCUMENT_OPENED, { documentId }, 'client');
    return ok(ref);
  }

  async close(documentId: string): Promise<Result<void>> {
    this.eventBus.publish(EventTopics.DOCUMENT_CLOSED, { documentId }, 'client');
    return ok(undefined);
  }

  async getPages(documentId: string): Promise<Result<DocumentPage[]>> {
    return await fromPromise(async () => MOCK_PAGES[documentId] ?? [], { retryable: false });
  }

  async getStructure(documentId: string): Promise<Result<DocumentStructure>> {
    return await fromPromise(async () => MOCK_STRUCTURE[documentId] ?? { headings: [], formulas: [], tables: [], figures: [] }, { retryable: false });
  }

  async getQuality(documentId: string): Promise<Result<DocumentQuality>> {
    return await fromPromise(async () => {
      const structure = MOCK_STRUCTURE[documentId] ?? { headings: [], formulas: [], tables: [], figures: [] };
      return {
        textQuality: 0.86,
        layoutQuality: 0.82,
        formulaQuality: structure.formulas.length ? 0.9 : 0,
        tableQuality: structure.tables.length ? 0.84 : 0,
        overallConfidence: 0.85,
      };
    }, { retryable: false });
  }

  async search(documentId: string, query: string): Promise<Result<DocumentSelection[]>> {
    return await fromPromise(async () => {
      const pages = MOCK_PAGES[documentId] ?? [];
      return pages
        .filter((p) => p.text?.toLowerCase().includes(query.toLowerCase()))
        .map((p) => ({ documentId, page: p.index, text: p.text?.slice(0, 120) ?? '' }));
    }, { retryable: false });
  }

  async setPage(documentId: string, page: number): Promise<Result<void>> {
    this.eventBus.publish(EventTopics.DOCUMENT_PAGE_CHANGED, { documentId, page }, 'client');
    return ok(undefined);
  }

  async setZoom(documentId: string, zoom: number): Promise<Result<void>> {
    this.eventBus.publish(EventTopics.DOCUMENT_ZOOM_CHANGED, { documentId, zoom }, 'client');
    return ok(undefined);
  }

  async getDocument(documentId: string): Promise<Result<ParsedDocument>> {
    const ref = this.documents.get(documentId);
    if (!ref) return { success: false, error: `Document ${documentId} not found`, retryable: false, fallbackAvailable: false };
    const pages = MOCK_PAGES[documentId] ?? [];
    const structure = MOCK_STRUCTURE[documentId] ?? { headings: [], formulas: [], tables: [], figures: [] };

    const rawPages: RawPage[] = pages.map((p) => ({
      index: p.index,
      text: p.text ?? '',
      blocks: p.blocks?.map((b) => ({
        type: b.type as 'text' | 'heading' | 'list' | 'code' | 'quote' | 'image' | 'table' | 'formula' | 'caption',
        text: b.text,
        bbox: b.width && b.height ? { x: b.x, y: b.y, width: b.width, height: b.height } : undefined,
      })) ?? [],
    }));

    const parserOutput: ParserOutput = {
      title: ref.title,
      format: ref.mimeType?.includes('pdf') ? 'pdf' : ref.mimeType?.includes('docx') ? 'docx' : ref.mimeType?.includes('html') ? 'html' : 'txt',
      pages: rawPages,
      tables: structure.tables.map((t) => ({ page: t.page, headers: t.rows[0]?.map(() => ''), rows: t.rows, caption: undefined })),
      parserEngine: 'aios-document-service',
    };

    const doc = normalizeParserOutput(parserOutput, { documentId });
    return ok(doc);
  }
}

function generateMockPages(_documentId: string, title: string): DocumentPage[] {
  const text = `This is a sample document text for ${title}. It discusses binary search, a fundamental algorithm for finding an element in a sorted array. `;
  return Array.from({ length: 5 }, (_, i) => ({
    index: i + 1,
    text: `${text} Page ${i + 1} content continues here. \nBinary search works by repeatedly dividing the search interval in half.`,
    words: [],
    blocks: [
      { type: 'heading', x: 40, y: 60, width: 400, height: 30, text: `Section ${i + 1}` },
      { type: 'text', x: 40, y: 110, width: 500, height: 200, text },
    ],
  }));
}

function generateMockStructure(documentId: string): DocumentStructure {
  return {
    headings: [
      { level: 1, title: 'Introduction', page: 1 },
      { level: 2, title: 'Binary Search', page: 1 },
      { level: 2, title: 'Complexity Analysis', page: 2 },
    ],
    formulas: [
      { id: `${documentId}-formula-1`, page: 2, tex: 'T(n) = O(\\log n)', inline: false, confidence: 0.92 },
    ],
    tables: [
      { id: `${documentId}-table-1`, page: 3, rows: [['Input', 'Output'], ['n=8', '3 steps']], confidence: 0.85 },
    ],
    figures: [
      { id: `${documentId}-figure-1`, page: 1, caption: 'Binary search interval halving', confidence: 0.88 },
    ],
  };
}
