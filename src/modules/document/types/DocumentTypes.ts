import type { Result } from '@/errors/types';

export interface DocumentReference {
  id: string;
  title: string;
  source?: string;
  mimeType?: string;
  pageCount?: number;
  uploadedAt: number;
}

export interface DocumentPage {
  index: number;
  text?: string;
  words?: WordBox[];
  blocks?: LayoutBlock[];
}

export interface WordBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutBlock {
  type: 'text' | 'image' | 'formula' | 'table' | 'heading' | 'list';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  confidence?: number;
}

export interface ExtractedFormula {
  id: string;
  page: number;
  tex: string;
  inline: boolean;
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface ExtractedTable {
  id: string;
  page: number;
  rows: string[][];
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface ExtractedFigure {
  id: string;
  page: number;
  caption?: string;
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface DocumentStructure {
  headings: DocumentHeading[];
  formulas: ExtractedFormula[];
  tables: ExtractedTable[];
  figures: ExtractedFigure[];
}

export interface DocumentHeading {
  level: number;
  title: string;
  page: number;
}

export interface DocumentQuality {
  textQuality: number;
  layoutQuality: number;
  formulaQuality: number;
  tableQuality: number;
  overallConfidence: number;
}

export interface DocumentSelection {
  documentId: string;
  page: number;
  text: string;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface IDocumentService {
  upload(file: File, documentId?: string): Promise<Result<DocumentReference>>;
  open(documentId: string): Promise<Result<DocumentReference>>;
  close(documentId: string): Promise<Result<void>>;
  getPages(documentId: string): Promise<Result<DocumentPage[]>>;
  getStructure(documentId: string): Promise<Result<DocumentStructure>>;
  getQuality(documentId: string): Promise<Result<DocumentQuality>>;
  search(documentId: string, query: string): Promise<Result<DocumentSelection[]>>;
  setPage(documentId: string, page: number): Promise<Result<void>>;
  setZoom(documentId: string, zoom: number): Promise<Result<void>>;
}
