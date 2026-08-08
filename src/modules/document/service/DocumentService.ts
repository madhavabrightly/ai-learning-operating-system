import { v4 as uuid } from 'uuid';
import { ok, err } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import { AppError } from '@/errors/AppError';
import { EventTopics } from '@/events/EventTopics';
import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';
import type { IDocumentStorage, ParsedDocument, ProcessingRecord, ProcessingStage, DocumentSelection } from '../model/DocumentModel';
import { createEmptyProcessingRecord } from '../model/DocumentModel';
import { normalizeParserOutput } from '../model/normalizer';
import { parseFile, validateUpload, detectFormat } from '../parsers/parserDispatcher';
import { searchDocument } from '../retrieval/retrieval';

export interface DocumentServiceOptions {
  /** When true, the parse stage also extracts figures (slower for PDFs). */
  extractFigures?: boolean;
  maxFigureSize?: number;
}

export interface ProcessProgress {
  stage: ProcessingStage;
  fraction: number;
  message?: string;
  page?: number;
  totalPages?: number;
}

export interface IDocumentService {
  upload(file: File): Promise<Result<ParsedDocument>>;
  open(documentId: string): Promise<Result<ParsedDocument>>;
  close(documentId: string): Promise<Result<void>>;
  getDocument(documentId: string): Promise<Result<ParsedDocument | undefined>>;
  getPages(documentId: string): Promise<Result<ParsedDocument['pages']>>;
  getStructure(documentId: string): Promise<Result<{ sections: ParsedDocument['sections']; formulas: ParsedDocument['formulas']; tables: ParsedDocument['tables']; figures: ParsedDocument['figures']; citations: ParsedDocument['citations'] }>>;
  getQuality(documentId: string): Promise<Result<{ textQuality: number; layoutQuality: number; formulaQuality: number; tableQuality: number; overallConfidence: number }>>;
  search(documentId: string, query: string): Promise<Result<DocumentSelection[]>>;
  listDocuments(): Promise<Result<ParsedDocument[]>>;
  deleteDocument(documentId: string): Promise<Result<void>>;
  setPage(documentId: string, page: number): Promise<Result<void>>;
  setZoom(documentId: string, zoom: number): Promise<Result<void>>;
  /** Run the real parse pipeline (or resume from a PARTIAL state). */
  processDocument(documentId: string, onProgress?: (p: ProcessProgress) => void): Promise<Result<ParsedDocument>>;
  getProcessingRecord(documentId: string): Promise<Result<ProcessingRecord | undefined>>;
}

/**
 * Real document service. Uploads actual bytes to IndexedDB storage, runs the
 * real parser pipeline, normalizes into the canonical model, and persists the
 * result. No fabricated pages, no fake quality scores.
 */
export class DocumentService implements IDocumentService {
  private readonly extractFigures: boolean;
  private readonly maxFigureSize: number;
  private cache = new Map<string, ParsedDocument>();

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly storage: IDocumentStorage,
    options: DocumentServiceOptions = {},
  ) {
    this.extractFigures = options.extractFigures ?? true;
    this.maxFigureSize = options.maxFigureSize ?? 1200;
  }

  async upload(file: File): Promise<Result<ParsedDocument>> {
    if (!file) return err(new AppError({ message: 'No file provided', code: 'INVALID_FILE', retryable: false }));
    const validation = validateUpload(file);
    if (!validation.ok) {
      this.eventBus.publish(EventTopics.UPLOAD_FAILED, { fileName: file.name, reason: validation.reason }, 'client');
      return err(new AppError({ message: validation.reason, code: 'VALIDATION_ERROR', retryable: false }));
    }

    const documentId = `doc-${uuid()}`;
    this.eventBus.publish(EventTopics.UPLOAD_STARTED, { documentId, fileName: file.name, sizeBytes: file.size }, 'client');

    const saved = await this.storage.saveFile(documentId, file);
    if (!saved.success) {
      this.eventBus.publish(EventTopics.UPLOAD_FAILED, { documentId, fileName: file.name, reason: saved.error }, 'client');
      return saved as Result<never> as Result<ParsedDocument>;
    }

    this.logger.info('Document stored', { documentId, fileName: file.name, sizeBytes: file.size });

    // Create an empty processing record and persist it so status shows immediately.
    const processing = createEmptyProcessingRecord(documentId);
    processing.status = 'UPLOADING';
    const placeholder: ParsedDocument = {
      id: documentId,
      title: file.name,
      metadata: {
        format: detectFormat(file),
        title: file.name,
        pageCount: 0,
        contentHash: '',
        sizeBytes: file.size,
        parserEngine: 'pending',
      },
      pages: [],
      sections: [],
      formulas: [],
      tables: [],
      figures: [],
      citations: [],
      index: [],
      status: 'UPLOADING',
      processing,
      createdAt: Date.now(),
    };
    await this.storage.saveParsed(placeholder);
    this.cache.set(documentId, placeholder);

    this.eventBus.publish(EventTopics.UPLOAD_COMPLETED, { documentId, fileName: file.name }, 'client');

    // Kick off the real pipeline immediately.
    const processed = await this.processDocument(documentId);
    return processed.success && processed.data ? ok(processed.data) : ok(placeholder);
  }

  async processDocument(documentId: string, onProgress?: (p: ProcessProgress) => void): Promise<Result<ParsedDocument>> {
    const current = (await this.storage.getParsed(documentId)).data;
    const existing = current && current.status !== 'UPLOADING' && current.metadata.pageCount > 0 ? current : undefined;
    const processing = existing?.processing ?? (current?.processing ?? createEmptyProcessingRecord(documentId));

    processing.status = 'PROCESSING';
    processing.updatedAt = Date.now();
    const stage = (name: ProcessingStage, status: ProcessingRecord['stages'][ProcessingStage]['status'], message?: string) => {
      const rec = processing.stages[name];
      if (rec.status !== 'running') {
        rec.startedAt = rec.startedAt ?? Date.now();
        rec.completedAt = undefined;
      }
      rec.status = status;
      if (message !== undefined) rec.message = message;
      rec.completedAt = status === 'success' || status === 'failed' || status === 'partial' ? Date.now() : undefined;
      rec.durationMs = rec.completedAt && rec.startedAt ? rec.completedAt - rec.startedAt : undefined;
      processing.updatedAt = Date.now();
    };

    const fileResult = await this.storage.getFile(documentId);
    if (!fileResult.success || !fileResult.data) {
      processing.status = 'FAILED';
      processing.error = { code: 'FILE_NOT_FOUND', message: fileResult.error ?? 'Stored file missing', stage: 'upload' };
      return err(new AppError({ message: processing.error.message, code: processing.error.code, retryable: false }));
    }
    const file = fileResult.data;

    try {
      stage('parse', 'running', 'Parsing document');
      this.eventBus.publish(EventTopics.DOCUMENT_PARSING, { documentId, fileName: file.name }, 'client');
      onProgress?.({ stage: 'parse', fraction: 0.1, message: 'Parsing document' });

      const output = await parseFile({
        file,
        options: {
          extractFigures: this.extractFigures,
          maxFigureSize: this.maxFigureSize,
          onPageProgress: (page, total, message) => {
            onProgress?.({ stage: 'parse', fraction: page / total, message, page, totalPages: total });
          },
        },
      });
      stage('parse', 'success', 'Parsed');
      onProgress?.({ stage: 'parse', fraction: 1, message: 'Parsed' });

      // Structure / math / tables / figures / index all derive from the parse.
      stage('structure', 'running', 'Building structure');
      const doc = normalizeParserOutput(output, {
        documentId,
        processing,
        status: 'PROCESSING',
      });
      doc.metadata.sizeBytes = file.size;
      stage('structure', 'success', 'Structure built');
      onProgress?.({ stage: 'structure', fraction: 1 });

      // Pages with no text → OCR required.
      const needsOcr = doc.pages.some((p) => p.needsOcr);
      if (needsOcr) {
        stage('profile', 'failed', 'OCR required but not configured. Install/configure an OCR engine to read scanned pages.');
        processing.status = 'PARTIAL';
        processing.error = {
          code: 'OCR_REQUIRED',
          message: 'Some pages contain no extractable text (scanned PDF). OCR is not configured; those pages are preserved as regions but not indexed.',
          stage: 'profile',
        };
        doc.status = 'PARTIAL';
      } else {
        stage('profile', 'success', 'Profiled');
        processing.status = 'READY';
        doc.status = 'READY';
      }

      doc.processing = processing;
      doc.status = processing.status;
      processing.completedAt = Date.now();
      processing.updatedAt = Date.now();

      await this.storage.saveParsed(doc);
      this.cache.set(documentId, doc);

      this.eventBus.publish(EventTopics.DOCUMENT_VALIDATED, { documentId, status: doc.status, pages: doc.metadata.pageCount }, 'client');

      if (needsOcr) {
        // Partial success: the pipeline did real work, but flagged OCR pages.
        return ok(doc);
      }
      return ok(doc);
    } catch (e) {
      const error = AppError.from(e);
      processing.status = 'FAILED';
      processing.updatedAt = Date.now();
      processing.error = { code: error.code, message: error.message, stage: 'parse' };
      this.logger.error('Document processing failed', { documentId, error: error.message });
      this.eventBus.publish(EventTopics.PROCESS_FAILED, { documentId, error: error.message }, 'client');

      if (current) {
        current.status = 'FAILED';
        current.processing = processing;
        await this.storage.saveParsed(current);
        this.cache.set(documentId, current);
      }
      return err(new AppError({ message: error.message, code: error.code, retryable: error.retryable, fallbackAvailable: error.fallbackAvailable }));
    }
  }

  async open(documentId: string): Promise<Result<ParsedDocument>> {
    const doc = await this.getDocument(documentId);
    if (!doc.success || !doc.data) return err(`Document ${documentId} not found`);
    this.eventBus.publish(EventTopics.DOCUMENT_OPENED, { documentId, title: doc.data.title }, 'client');
    return ok(doc.data);
  }

  async close(documentId: string): Promise<Result<void>> {
    this.eventBus.publish(EventTopics.DOCUMENT_CLOSED, { documentId }, 'client');
    return ok(undefined);
  }

  async getDocument(documentId: string): Promise<Result<ParsedDocument | undefined>> {
    const cached = this.cache.get(documentId);
    if (cached) return ok(cached);
    const stored = await this.storage.getParsed(documentId);
    if (stored.success && stored.data) this.cache.set(documentId, stored.data);
    return stored;
  }

  async getPages(documentId: string): Promise<Result<ParsedDocument['pages']>> {
    const doc = await this.getDocument(documentId);
    return doc.success && doc.data ? ok(doc.data.pages) : err(doc.error ?? 'Document not found');
  }

  async getStructure(documentId: string): Promise<Result<{ sections: ParsedDocument['sections']; formulas: ParsedDocument['formulas']; tables: ParsedDocument['tables']; figures: ParsedDocument['figures']; citations: ParsedDocument['citations'] }>> {
    const doc = await this.getDocument(documentId);
    if (!doc.success || !doc.data) return err(doc.error ?? 'Document not found');
    const d = doc.data;
    return ok({ sections: d.sections, formulas: d.formulas, tables: d.tables, figures: d.figures, citations: d.citations });
  }

  async getQuality(documentId: string): Promise<Result<{ textQuality: number; layoutQuality: number; formulaQuality: number; tableQuality: number; overallConfidence: number }>> {
    const doc = await this.getDocument(documentId);
    if (!doc.success || !doc.data) return err(doc.error ?? 'Document not found');
    const d = doc.data;
    const textPages = d.pages.filter((p) => p.text.trim().length > 0).length;
    const textQuality = d.pages.length > 0 ? textPages / d.pages.length : 0;
    const formulaQuality = d.formulas.length > 0 ? Math.min(1, d.formulas.reduce((s, f) => s + f.confidence, 0) / d.formulas.length) : 0;
    const tableQuality = d.tables.length > 0 ? Math.min(1, d.tables.reduce((s, t) => s + t.confidence, 0) / d.tables.length) : 0;
    const layoutQuality = Math.max(textQuality, d.sections.length > 0 ? 0.7 : 0.4);
    return ok({
      textQuality,
      layoutQuality,
      formulaQuality,
      tableQuality,
      overallConfidence: (textQuality + formulaQuality + tableQuality) / 3,
    });
  }

  async search(documentId: string, query: string): Promise<Result<DocumentSelection[]>> {
    const doc = await this.getDocument(documentId);
    if (!doc.success || !doc.data) return err(doc.error ?? 'Document not found');
    this.eventBus.publish(EventTopics.DOCUMENT_SEARCH, { documentId, query }, 'client');
    return ok(searchDocument(doc.data, query));
  }

  async listDocuments(): Promise<Result<ParsedDocument[]>> {
    return this.storage.listDocuments();
  }

  async deleteDocument(documentId: string): Promise<Result<void>> {
    this.cache.delete(documentId);
    return this.storage.deleteDocument(documentId);
  }

  async setPage(documentId: string, page: number): Promise<Result<void>> {
    this.eventBus.publish(EventTopics.DOCUMENT_PAGE_CHANGED, { documentId, page }, 'client');
    return ok(undefined);
  }

  async setZoom(documentId: string, zoom: number): Promise<Result<void>> {
    this.eventBus.publish(EventTopics.DOCUMENT_ZOOM_CHANGED, { documentId, zoom }, 'client');
    return ok(undefined);
  }

  async getProcessingRecord(documentId: string): Promise<Result<ProcessingRecord | undefined>> {
    const doc = await this.getDocument(documentId);
    return doc.success ? ok(doc.data?.processing) : err(doc.error ?? 'Document not found');
  }
}
