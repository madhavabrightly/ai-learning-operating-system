import type {
  DocumentBlock,
  DocumentMetadata,
  DocumentPage,
  DocumentSection,
  ParsedDocument,
  ProcessingRecord,
  BlockSource,
  Formula,
} from '../model/DocumentModel';
import { createEmptyProcessingRecord } from '../model/DocumentModel';
import { detectDisplayMath } from '../math/mathExtraction';
// ---------------------------------------------------------------------------

export interface RawPage {
  index: number;
  text: string;
  width?: number;
  height?: number;
  /** Optional pre-classified blocks from the parser (PDF positions, DOCX HTML). */
  blocks?: RawBlock[];
}

export interface RawBlock {
  type: 'text' | 'heading' | 'list' | 'code' | 'quote' | 'image' | 'table' | 'formula' | 'caption';
  text?: string;
  headingLevel?: number;
  items?: string[];
  ordered?: boolean;
  rows?: string[][];
  headers?: string[];
  imageUrl?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
  tableCaption?: string;
}

export interface RawTable {
  page: number;
  caption?: string;
  headers: string[];
  rows: string[][];
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
}

export interface RawFigure {
  page: number;
  caption?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  imageUrl?: string;
  confidence?: number;
}

export interface ParserOutput {
  title: string;
  format: DocumentMetadata['format'];
  pages: RawPage[];
  tables?: RawTable[];
  figures?: RawFigure[];
  wordCount?: number;
  metadata?: Partial<DocumentMetadata>;
  parserEngine: string;
}

export interface NormalizeOptions {
  documentId: string;
  status?: ParsedDocument['status'];
  processing?: ProcessingRecord;
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

let blockCounter = 0;
function nextBlockId(documentId: string): string {
  blockCounter++;
  return `${documentId}-block-${blockCounter}`;
}

function toSource(page: number, raw?: { bbox?: { x: number; y: number; width: number; height: number }; confidence?: number }): BlockSource {
  const source: BlockSource = { page };
  if (raw?.bbox) source.bbox = raw.bbox;
  if (raw?.confidence !== undefined) source.confidence = raw.confidence;
  return source;
}

function textToBlocks(
  text: string,
  page: number,
  documentId: string,
  rawBlocks: RawBlock[] | undefined,
  tablesByPage: Map<number, NonNullable<ParserOutput['tables']>>,
  formulasByPage: Map<number, Formula[]>,
): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];

  if (rawBlocks && rawBlocks.length > 0) {
    // Parser provided classified blocks (PDF, DOCX, MD).
    for (const raw of rawBlocks) {
      if (raw.type === 'heading') {
        blocks.push({
          id: nextBlockId(documentId),
          type: 'heading',
          text: raw.text,
          headingLevel: raw.headingLevel ?? 1,
          source: toSource(page, raw),
        });
      } else if (raw.type === 'list') {
        blocks.push({
          id: nextBlockId(documentId),
          type: 'list',
          items: raw.items ?? [],
          ordered: raw.ordered,
          source: toSource(page, raw),
        });
      } else if (raw.type === 'code') {
        blocks.push({ id: nextBlockId(documentId), type: 'code', text: raw.text, source: toSource(page, raw) });
      } else if (raw.type === 'quote') {
        blocks.push({ id: nextBlockId(documentId), type: 'quote', text: raw.text, source: toSource(page, raw) });
      } else if (raw.type === 'image') {
        // Figures are handled separately via rawFigures; here just emit a marker block.
        blocks.push({ id: nextBlockId(documentId), type: 'figure', text: raw.text ?? 'Figure', source: toSource(page, raw) });
      } else if (raw.type === 'table') {
        blocks.push({ id: nextBlockId(documentId), type: 'table', text: raw.tableCaption, source: toSource(page, raw) });
      } else if (raw.type === 'formula') {
        const formulaId = raw.text ? `${documentId}-formula-raw-${page}-${blocks.length}` : undefined;
        if (formulaId) {
          formulasByPage.set(page, formulasByPage.get(page) ?? []);
          const existing = formulasByPage.get(page) ?? [];
          if (!existing.some((f) => f.id === formulaId)) {
            existing.push({
              id: formulaId,
              page,
              tex: raw.text ?? '',
              inline: false,
              confidence: raw.confidence ?? 0.6,
              source: toSource(page, raw),
            });
          }
        }
        blocks.push({ id: nextBlockId(documentId), type: 'formula', formulaId, source: toSource(page, raw) });
      } else if (raw.type === 'caption') {
        blocks.push({ id: nextBlockId(documentId), type: 'caption', text: raw.text, source: toSource(page, raw) });
      } else {
        // Plain text or fallback: split on double newlines into paragraphs.
        const paragraphs = (raw.text ?? '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
        for (const para of paragraphs) {
          blocks.push({ id: nextBlockId(documentId), type: 'text', text: para, source: toSource(page, raw) });
        }
      }
    }
    return blocks;
  }

  // No classified blocks: derive structure from the text heuristically.
  const lines = text.split('\n');
  let currentList: string[] = [];
  let listOrdered = false;
  const flushList = () => {
    if (currentList.length > 0) {
      blocks.push({ id: nextBlockId(documentId), type: 'list', items: currentList, ordered: listOrdered, source: { page } });
      currentList = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    // Heading detection: # ## ### or "Section N" / ALL CAPS short lines.
    const mdHeading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (mdHeading) {
      flushList();
      blocks.push({
        id: nextBlockId(documentId),
        type: 'heading',
        text: mdHeading[2] ?? '',
        headingLevel: mdHeading[1]?.length ?? 1,
        source: { page },
      });
      continue;
    }
    const numberedHeading = /^(Section\s+\d+[.:]?|Chapter\s+\d+[.:]?)\s*(.*)$/i.exec(line);
    if (numberedHeading && line.length < 80) {
      flushList();
      blocks.push({
        id: nextBlockId(documentId),
        type: 'heading',
        text: `${numberedHeading[1]} ${numberedHeading[2] ?? ''}`.trim(),
        headingLevel: 1,
        source: { page },
      });
      continue;
    }
    const shortCaps = /^[A-Z][A-Z0-9 .:-]{2,60}$/.exec(line) && line.length < 70;
    if (shortCaps) {
      flushList();
      blocks.push({ id: nextBlockId(documentId), type: 'heading', text: line, headingLevel: 2, source: { page } });
      continue;
    }
    // List items.
    const listItem = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      listOrdered = /^\s*\d+/.test(line);
      currentList.push(listItem[1] ?? '');
      continue;
    }
    flushList();
    // Table cell / formula placeholder blocks are handled by later stages;
    // here we emit text paragraphs.
    blocks.push({ id: nextBlockId(documentId), type: 'text', text: line, source: { page } });
  }
  flushList();

  // Attach formula blocks for formulas detected on this page.
  const pageFormulas = formulasByPage.get(page);
  if (pageFormulas && pageFormulas.length > 0) {
    // Map placeholder text back to formula blocks. The math extraction pass
    // replaced inline/display math with \uFFFC[formula:ID]\uFFFC markers.
    const markerRe = /\uFFFC\[formula:([^\]]+)\]\uFFFC/g;
    const result: DocumentBlock[] = [];
    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        let last = 0;
        let m: RegExpExecArray | null;
        markerRe.lastIndex = 0;
        let inserted = false;
        while ((m = markerRe.exec(block.text)) !== null) {
          inserted = true;
          const before = block.text.slice(last, m.index).trim();
          if (before) result.push({ ...block, id: nextBlockId(documentId), text: before, source: block.source });
          result.push({ id: nextBlockId(documentId), type: 'formula', formulaId: m[1], source: block.source });
          last = m.index + m[0].length;
        }
        if (inserted) {
          const after = block.text.slice(last).trim();
          if (after) result.push({ ...block, id: nextBlockId(documentId), text: after, source: block.source });
          continue;
        }
      }
      result.push(block);
    }
    blocks.length = 0;
    blocks.push(...result);
  }

  // Attach table marker blocks.
  const tables = tablesByPage.get(page);
  if (tables && tables.length > 0) {
    for (const table of tables) {
      blocks.push({
        id: nextBlockId(documentId),
        type: 'table',
        text: table.caption,
        source: { page, bbox: table.bbox },
      });
    }
  }

  return blocks;
}

function buildSections(pages: DocumentPage[], documentId: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  let current: DocumentSection | null = null;
  let sectionCounter = 0;

  const ensureCurrent = (level: number, title: string, page: number): DocumentSection => {
    sectionCounter++;
    const section: DocumentSection = {
      id: `${documentId}-section-${sectionCounter}`,
      title,
      level,
      page,
      blockIds: [],
      text: '',
    };
    sections.push(section);
    current = section;
    return section;
  };

  for (const page of pages) {
    for (const block of page.blocks) {
      if (block.type === 'heading') {
        ensureCurrent(block.headingLevel ?? 1, block.text ?? 'Untitled', page.index);
        continue;
      }
      const target = current ?? ensureCurrent(1, 'Introduction', page.index);
      target.blockIds.push(block.id);
      if (block.text) target.text += (target.text ? '\n' : '') + block.text;
      if (block.type === 'list' && block.items) target.text += (target.text ? '\n' : '') + block.items.join('\n');
    }
  }

  return sections;
}

function buildIndex(pages: DocumentPage[], documentId: string): ParsedDocument['index'] {
  const STOP = new Set([
    'the', 'and', 'for', 'are', 'was', 'with', 'that', 'this', 'have', 'from', 'they', 'will',
    'would', 'there', 'their', 'what', 'which', 'when', 'where', 'who', 'how', 'can', 'could',
    'should', 'may', 'might', 'must', 'than', 'then', 'them', 'these', 'those', 'into', 'over',
    'under', 'again', 'further', 'once', 'here', 'about', 'above', 'below', 'between', 'through',
    'during', 'before', 'after', 'also', 'because', 'been', 'being', 'both', 'but', 'by', 'does',
    'doing', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'so',
    'too', 'very', 'just', 'out', 'up', 'down', 'off', 'on', 'in', 'at', 'to', 'of', 'a', 'an',
    'is', 'it', 'as', 'or', 'not', 'no', 'if', 'then', 'than',
  ]);
  const entries: ParsedDocument['index'] = [];
  let entryCounter = 0;

  for (const page of pages) {
    const words = page.text.match(/[a-zA-Z][a-zA-Z0-9'-]{2,}/g) ?? [];
    const seen = new Set<string>();
    for (const word of words) {
      const term = word.toLowerCase();
      if (STOP.has(term) || seen.has(term)) continue;
      seen.add(term);
      entryCounter++;
      entries.push({
        term,
        page: page.index,
        blockId: `${documentId}-index-${entryCounter}`,
        charRange: undefined,
      });
    }
  }
  return entries;
}

/** Normalize raw parser output into the canonical ParsedDocument. */
export function normalizeParserOutput(output: ParserOutput, options: NormalizeOptions): ParsedDocument {
  const { documentId } = options;
  const now = Date.now();

  const tablesByPage = new Map<number, NonNullable<ParserOutput['tables']>>();
  for (const t of output.tables ?? []) {
    const list = tablesByPage.get(t.page) ?? [];
    list.push(t);
    tablesByPage.set(t.page, list);
  }

  const formulasByPage = new Map<number, Formula[]>();

  const pages: DocumentPage[] = output.pages.map((rawPage) => {
    const pageFormulas = detectDisplayMath(rawPage.text, rawPage.index, documentId, true);
    const existing = formulasByPage.get(rawPage.index) ?? [];
    formulasByPage.set(rawPage.index, [...existing, ...pageFormulas.formulas]);

    return {
      index: rawPage.index,
      text: pageFormulas.clean,
      blocks: textToBlocks(pageFormulas.clean, rawPage.index, documentId, rawPage.blocks, tablesByPage, formulasByPage),
      blockIds: [],
      width: rawPage.width,
      height: rawPage.height,
      needsOcr: rawPage.text.trim().length === 0,
    };
  });

  // Compute blockIds after all blocks are created.
  for (const page of pages) {
    page.blockIds = page.blocks.map((b) => b.id);
  }

  const sections = buildSections(pages, documentId);
  const index = buildIndex(pages, documentId);

  // Canonical tables + figures.
  const tables = (output.tables ?? []).map((t, i) => ({
    id: `${documentId}-table-${i + 1}`,
    page: t.page,
    caption: t.caption,
    headers: t.headers ?? [],
    rows: (t.rows ?? []).map((r) => r.map((cell) => ({ text: cell }))),
    reduced: !t.headers || t.headers.length === 0,
    confidence: t.confidence ?? 0.7,
    bbox: t.bbox,
    source: { page: t.page, bbox: t.bbox },
  }));

  // Attach tableId to table blocks so the viewer resolves the exact table.
  const tableBlocksByPage = new Map<number, typeof tables>();
  for (const t of tables) {
    const list = tableBlocksByPage.get(t.page) ?? [];
    list.push(t);
    tableBlocksByPage.set(t.page, list);
  }
  for (const page of pages) {
    const pageTables = tableBlocksByPage.get(page.index) ?? [];
    let tableIdx = 0;
    for (const block of page.blocks) {
      if (block.type === 'table') {
        const table = pageTables[tableIdx];
        if (table) {
          block.tableId = table.id;
          block.text = block.text ?? table.caption;
        }
        tableIdx++;
      }
    }
  }

  const figures = (output.figures ?? []).map((f, i) => ({
    id: `${documentId}-figure-${i + 1}`,
    page: f.page,
    caption: f.caption,
    confidence: f.confidence ?? 0.6,
    bbox: f.bbox,
    imageUrl: f.imageUrl,
    hasImage: Boolean(f.imageUrl),
    source: { page: f.page, bbox: f.bbox },
  }));

  const allFormulas = [...formulasByPage.values()].flat();
  const needsOcr = pages.some((p) => p.needsOcr);

  const metadata: DocumentMetadata = {
    format: output.format,
    title: output.title,
    pageCount: pages.length,
    wordCount: output.wordCount ?? pages.reduce((s, p) => s + (p.text.match(/\S+/g)?.length ?? 0), 0),
    contentHash: simpleHash(pages.map((p) => p.text).join('') + output.title),
    sizeBytes: 0,
    parserEngine: output.parserEngine,
    requiresOcr: needsOcr,
    ocrStatus: needsOcr ? 'required' : 'not_required',
    ...output.metadata,
  };

  const processing = options.processing ?? createEmptyProcessingRecord(documentId);
  processing.updatedAt = now;

  return {
    id: documentId,
    title: output.title,
    metadata,
    pages,
    sections,
    formulas: allFormulas,
    tables,
    figures,
    citations: [],
    index,
    status: options.status ?? 'READY',
    processing,
    createdAt: now,
  };
}

/** Deterministic content hash (FNV-1a 32-bit). Good enough for cache keys. */
export function simpleHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
