import type { Result } from '@/errors/types';

// ---------------------------------------------------------------------------
// Canonical document model.
//
// Every parser output is normalized into this model. Downstream services
// (viewer, search, retrieval, graph, chat grounding) consume ONLY this shape
// and never raw parser-specific output.
// ---------------------------------------------------------------------------

export type DocumentStatus = 'UPLOADING' | 'PROFILING' | 'PROCESSING' | 'PARTIAL' | 'READY' | 'FAILED';

export type ProcessingStage =
  | 'upload'
  | 'profile'
  | 'parse'
  | 'structure'
  | 'math'
  | 'tables'
  | 'figures'
  | 'concepts'
  | 'index';

export type DocumentFormat = 'pdf' | 'docx' | 'txt' | 'markdown' | 'html' | 'unsupported';

export type BlockType = 'text' | 'heading' | 'list' | 'formula' | 'table' | 'figure' | 'code' | 'quote' | 'caption';

/** Source provenance — where a block came from in the original document. */
export interface BlockSource {
  page: number;
  /** Character offset range in the raw text of the page, when known. */
  charRange?: { start: number; end: number };
  /** Bounding box in PDF coordinates (points). */
  bbox?: { x: number; y: number; width: number; height: number };
  sectionId?: string;
  confidence?: number;
}

/** A table cell; merged=true when the cell spans (reduced representation). */
export interface TableCell {
  text: string;
  rowSpan?: number;
  colSpan?: number;
}

export interface Table {
  id: string;
  page: number;
  caption?: string;
  headers: string[];
  rows: TableCell[][];
  /** True when extraction could not preserve full grid structure. */
  reduced: boolean;
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
  source: BlockSource;
}

export interface Formula {
  id: string;
  page: number;
  /** LaTeX source. */
  tex: string;
  inline: boolean;
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
  /** Original visual region preserved when formula extraction failed. */
  fallbackText?: string;
  source: BlockSource;
}

export interface Figure {
  id: string;
  page: number;
  caption?: string;
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
  /** Object URL or data URL of the rendered image, when available. */
  imageUrl?: string;
  /** Placeholder region when the image could not be rasterized. */
  hasImage: boolean;
  source: BlockSource;
}

export interface Citation {
  id: string;
  page: number;
  raw: string;
  source?: BlockSource;
}

export interface DocumentBlock {
  id: string;
  type: BlockType;
  text?: string;
  headingLevel?: number;
  /** List items when type === 'list'. */
  items?: string[];
  ordered?: boolean;
  formulaId?: string;
  tableId?: string;
  figureId?: string;
  source: BlockSource;
}

export interface DocumentSection {
  id: string;
  title: string;
  level: number;
  page: number;
  blockIds: string[];
  text: string;
}

export interface DocumentPage {
  index: number;
  /** Plain text of the page (parsed or OCR-derived). */
  text: string;
  blocks: DocumentBlock[];
  blockIds: string[];
  width?: number;
  height?: number;
  /** True when the page required OCR to be readable but OCR is unavailable. */
  needsOcr?: boolean;
}

export interface DocumentMetadata {
  format: DocumentFormat;
  title: string;
  author?: string;
  createdAt?: number;
  modifiedAt?: number;
  pageCount: number;
  wordCount?: number;
  /** Content hash for cache invalidation. */
  contentHash: string;
  sizeBytes: number;
  /** Engine used for parsing. */
  parserEngine: string;
  /** Set when the document is scanned-image-only and OCR is required. */
  requiresOcr?: boolean;
  ocrStatus?: 'not_required' | 'required' | 'completed' | 'unavailable';
}

export interface DocumentIndexEntry {
  term: string;
  page: number;
  blockId: string;
  charRange?: { start: number; end: number };
}

export interface ProcessingRecord {
  documentId: string;
  status: DocumentStatus;
  stages: Record<ProcessingStage, StageRecord>;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: { code: string; message: string; stage: ProcessingStage };
}

export interface DocumentSelection {
  documentId: string;
  page: number;
  text: string;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface StageRecord {
  status: 'pending' | 'running' | 'success' | 'partial' | 'failed' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  message?: string;
  retryCount: number;
}

export interface ParsedDocument {
  id: string;
  title: string;
  metadata: DocumentMetadata;
  pages: DocumentPage[];
  sections: DocumentSection[];
  formulas: Formula[];
  tables: Table[];
  figures: Figure[];
  citations: Citation[];
  index: DocumentIndexEntry[];
  status: DocumentStatus;
  processing: ProcessingRecord;
  createdAt: number;
}

export interface IDocumentStorage {
  /** Persist the raw file bytes for a document. */
  saveFile(documentId: string, file: File): Promise<Result<void>>;
  getFile(documentId: string): Promise<Result<File>>;
  saveParsed(document: ParsedDocument): Promise<Result<void>>;
  getParsed(documentId: string): Promise<Result<ParsedDocument | undefined>>;
  listDocuments(): Promise<Result<ParsedDocument[]>>;
  deleteDocument(documentId: string): Promise<Result<void>>;
}

export function createEmptyProcessingRecord(documentId: string): ProcessingRecord {
  const stage = (): StageRecord => ({ status: 'pending', retryCount: 0 });
  return {
    documentId,
    status: 'UPLOADING',
    stages: {
      upload: stage(),
      profile: stage(),
      parse: stage(),
      structure: stage(),
      math: stage(),
      tables: stage(),
      figures: stage(),
      concepts: stage(),
      index: stage(),
    },
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Word count of a parsed document. */
export function countWords(doc: ParsedDocument): number {
  return doc.pages.reduce((sum, p) => sum + (p.text.match(/\S+/g)?.length ?? 0), 0);
}
