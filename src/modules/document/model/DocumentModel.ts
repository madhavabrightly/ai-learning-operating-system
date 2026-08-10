import type { Result } from '@/errors/types';

// ---------------------------------------------------------------------------
// Canonical document model — every parser output normalizes into these types.
// ---------------------------------------------------------------------------

export interface BlockSource {
  page: number;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
}

export interface DocumentBlock {
  id: string;
  type: 'text' | 'heading' | 'list' | 'code' | 'quote' | 'image' | 'table' | 'formula' | 'caption' | 'figure';
  text?: string;
  headingLevel?: number;
  items?: string[];
  ordered?: boolean;
  formulaId?: string;
  tableId?: string;
  figureId?: string;
  source: BlockSource;
}

export interface DocumentPage {
  index: number;
  text: string;
  blocks: DocumentBlock[];
  blockIds: string[];
  width?: number;
  height?: number;
  needsOcr?: boolean;
}

export interface DocumentMetadata {
  format: 'pdf' | 'docx' | 'html' | 'md' | 'txt' | 'image' | 'unknown';
  title: string;
  pageCount: number;
  wordCount: number;
  contentHash: string;
  sizeBytes: number;
  parserEngine: string;
  requiresOcr: boolean;
  ocrStatus: 'required' | 'not_required' | 'completed' | 'failed';
  language?: string;
}

export interface DocumentSection {
  id: string;
  title: string;
  level: number;
  page: number;
  blockIds: string[];
  text: string;
}

export interface Formula {
  id: string;
  page: number;
  tex: string;
  inline: boolean;
  confidence: number;
  source?: BlockSource;
  fallbackText?: string;
}

export interface Table {
  id: string;
  page: number;
  caption?: string;
  headers: string[];
  rows: { text: string }[][];
  reduced: boolean;
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
  source: BlockSource;
}

export interface Figure {
  id: string;
  page: number;
  caption?: string;
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
  imageUrl?: string;
  hasImage: boolean;
  source: BlockSource;
}

export interface IndexEntry {
  term: string;
  page: number;
  blockId: string;
  charRange?: { start: number; end: number };
}

export interface ProcessingRecord {
  documentId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  stages: ProcessingStage[];
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  retryCount: number;
}

export interface ProcessingStage {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface Citation {
  id: string;
  format: 'text' | 'bibtex' | 'doi';
  content: string;
  page?: number;
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
  index: IndexEntry[];
  status: 'PROCESSING' | 'READY' | 'ERROR';
  processing: ProcessingRecord;
  createdAt: number;
}

export function createEmptyProcessingRecord(documentId: string): ProcessingRecord {
  return {
    documentId,
    status: 'pending',
    stages: [],
    startedAt: Date.now(),
    updatedAt: Date.now(),
    retryCount: 0,
  };
}