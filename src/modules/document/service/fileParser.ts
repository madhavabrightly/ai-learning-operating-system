import type {
  DocumentPage,
  DocumentStructure,
  DocumentHeading,
  ExtractedFormula,
  ExtractedTable,
  LayoutBlock,
} from '../types/DocumentTypes';

// ---------------------------------------------------------------------------
// Real file-content parser for uploaded documents.
//
// - .txt / .md        raw text, split into pages at form feeds or ~4k-char
//                     paragraph boundaries
// - .pdf              text extraction per page via pdfjs-dist
// - .html             tag-stripped text
// - .docx             minimal ZIP reader + DecompressionStream('deflate-raw')
//                     to pull word/document.xml out of the package
//
// Every page carries at least one text block so the viewer has something to
// render, and a structure (headings / formulas / tables) is derived from the
// real text so the knowledge graph and chat grounding stop seeing demo data.
// ---------------------------------------------------------------------------

export type ParsedFormat = 'txt' | 'md' | 'pdf' | 'html' | 'docx' | 'unknown';

export interface ParsedFileResult {
  pages: DocumentPage[];
  structure: DocumentStructure;
  format: ParsedFormat;
  wordCount: number;
}

/** Rough per-page size for text documents without explicit page breaks. */
const TARGET_PAGE_CHARS = 4000;

export function emptyStructure(): DocumentStructure {
  return { headings: [], formulas: [], tables: [], figures: [] };
}

export function detectFormat(name: string, mime: string): ParsedFormat {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const m = mime.toLowerCase();
  if (ext === 'pdf' || m === 'application/pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown' || m === 'text/markdown') return 'md';
  if (ext === 'txt' || m.startsWith('text/')) return 'txt';
  if (ext === 'html' || ext === 'htm' || m === 'text/html') return 'html';
  if (ext === 'docx' || m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  return 'unknown';
}

/** Parse an uploaded File into pages + structure. Never throws. */
export async function parseFile(file: File): Promise<ParsedFileResult> {
  const format = detectFormat(file.name, file.type);

  try {
    switch (format) {
      case 'pdf':
        return await parsePdf(await file.arrayBuffer());
      case 'html':
        return parseText(stripHtml(await file.text()), 'html');
      case 'docx':
        return await parseDocx(await file.arrayBuffer());
      case 'md':
      case 'txt':
      default:
        return parseText(await file.text(), format === 'md' ? 'md' : 'txt');
    }
  } catch (error) {
    // A parse failure must never take the app down — degrade to empty pages.
    console.warn('[DocumentService] File parsing failed, falling back to empty pages', { name: file.name, format, error });
    return { pages: [], structure: emptyStructure(), format, wordCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Text (.txt / .md / html-stripped) parsing
// ---------------------------------------------------------------------------

function parseText(rawText: string, format: ParsedFormat): ParsedFileResult {
  const text = sanitizeText(rawText);
  const pageTexts = splitIntoPages(text);
  const pages: DocumentPage[] = pageTexts.map((pageText, i) => ({
    index: i + 1,
    text: pageText,
    blocks: textToBlocks(pageText),
  }));

  const documentId = `text-${simpleHash(text)}`;
  const structure = deriveStructure(pages, documentId);
  const wordCount = pages.reduce((sum, p) => sum + (p.text?.match(/\S+/g)?.length ?? 0), 0);

  return { pages, structure, format, wordCount };
}

/** Drop binary garbage / replacement chars so mojibake never reaches the AI. */
function sanitizeText(input: string): string {
  let text = input.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  // If the stream was binary, replacement chars dominate — bail to empty.
  const replaced = (text.match(/\uFFFD/g) ?? []).length;
  const sample = text.slice(0, 2000);
  if (replaced > 0 && replaced > sample.length * 0.2) return '';
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function splitIntoPages(text: string): string[] {
  // Explicit form-feed page breaks win when present.
  const formFeedParts = text
    .split('\f')
    .map((s) => s.trim())
    .filter(Boolean);
  const parts = formFeedParts.length > 1 ? formFeedParts : [text];

  const out: string[] = [];
  for (const part of parts) {
    if (part.length <= TARGET_PAGE_CHARS) {
      out.push(part);
    } else {
      out.push(...splitLongText(part));
    }
  }
  return out.filter((p) => p.trim().length > 0);
}

/** Split an over-long page at paragraph boundaries near the target size. */
function splitLongText(text: string): string[] {
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > TARGET_PAGE_CHARS) {
    const window = remaining.slice(0, TARGET_PAGE_CHARS);
    const paraBreak = window.lastIndexOf('\n\n');
    const lineBreak = window.lastIndexOf('\n');
    const cutAt = paraBreak > TARGET_PAGE_CHARS * 0.5 ? paraBreak : lineBreak > TARGET_PAGE_CHARS * 0.6 ? lineBreak : TARGET_PAGE_CHARS;
    out.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) out.push(remaining);
  return out.filter(Boolean);
}

/** Lightweight block extraction: markdown headings + paragraphs. */
function textToBlocks(text: string): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const mdHeading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (mdHeading) {
      blocks.push({ type: 'heading', x: 0, y: 0, width: 0, height: 0, text: mdHeading[2] ?? '', confidence: 0.95 });
      continue;
    }
    const sectionHeading = /^(Section\s+\d+[.:]?|Chapter\s+\d+[.:]?)\s*(.*)$/i.exec(line);
    if (sectionHeading && line.length < 80) {
      blocks.push({ type: 'heading', x: 0, y: 0, width: 0, height: 0, text: line, confidence: 0.9 });
      continue;
    }
    blocks.push({ type: 'text', x: 0, y: 0, width: 0, height: 0, text: line });
  }
  return blocks.length > 0 ? blocks : [{ type: 'text', x: 0, y: 0, width: 0, height: 0, text }];
}

/** Derive headings / formulas / tables from the real page text. */
function deriveStructure(pages: DocumentPage[], documentId: string): DocumentStructure {
  const headings: DocumentHeading[] = [];
  const formulas: ExtractedFormula[] = [];
  const tables: ExtractedTable[] = [];
  let formulaCounter = 0;
  let tableCounter = 0;

  for (const page of pages) {
    const text = page.text ?? '';
    let tableLines: string[] = [];
    const flushTable = () => {
      if (tableLines.length > 0) {
        const rows = rowsFromTableLines(tableLines);
        if (rows.length > 0) {
          tableCounter++;
          tables.push({ id: `${documentId}-table-${tableCounter}`, page: page.index, rows, confidence: 0.75 });
        }
        tableLines = [];
      }
    };

    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) {
        flushTable();
        continue;
      }
      const mdHeading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (mdHeading) {
        flushTable();
        headings.push({ level: mdHeading[1]?.length ?? 1, title: mdHeading[2] ?? '', page: page.index });
        continue;
      }
      const sectionHeading = /^(Section\s+\d+[.:]?|Chapter\s+\d+[.:]?)\s*(.*)$/i.exec(line);
      if (sectionHeading && line.length < 80) {
        flushTable();
        headings.push({ level: 1, title: line, page: page.index });
        continue;
      }
      const shortCaps = /^[A-Z][A-Z0-9 .:-]{2,60}$/.exec(line) && line.length < 70;
      if (shortCaps) {
        flushTable();
        headings.push({ level: 2, title: line, page: page.index });
        continue;
      }
      const displayMath = /\$\$([\s\S]+?)\$\$/.exec(line);
      if (displayMath) {
        flushTable();
        formulaCounter++;
        formulas.push({ id: `${documentId}-formula-${formulaCounter}`, page: page.index, tex: displayMath[1]?.trim() ?? '', inline: false, confidence: 0.9 });
        continue;
      }
      const inlineMath = /\$([^$\n]+?)\$/.exec(line);
      if (inlineMath) {
        formulaCounter++;
        formulas.push({ id: `${documentId}-formula-${formulaCounter}`, page: page.index, tex: inlineMath[1]?.trim() ?? '', inline: true, confidence: 0.8 });
      }
      if (/^\|.*\|$/.test(line)) {
        tableLines.push(line);
        continue;
      }
      flushTable();
    }
    flushTable();
  }

  return { headings, formulas, tables, figures: [] };
}

/** Convert contiguous markdown pipe-table lines into rows (skips separators). */
function rowsFromTableLines(lines: string[]): string[][] {
  const rows: string[][] = [];
  for (const line of lines) {
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''));
    if (cells.length === 0) continue;
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // |---|---| separator
    rows.push(cells);
  }
  return rows;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------------------
// PDF parsing via pdfjs-dist (dynamic import keeps the main bundle light)
// ---------------------------------------------------------------------------

let pdfWorkerConfigured = false;

async function loadPdfJs(): Promise<typeof import('pdfjs-dist')> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfWorkerConfigured && typeof window !== 'undefined') {
    // Browser: Vite statically rewrites this URL and emits the worker asset.
    // Node (tests/SSR): pdfjs keeps its default "./pdf.worker.mjs" fake-worker
    // import, which resolves correctly against the installed package.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    pdfWorkerConfigured = true;
  }
  return pdfjs;
}

async function parsePdf(buffer: ArrayBuffer): Promise<ParsedFileResult> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const pages: DocumentPage[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = pdfItemsToString(content.items as Array<{ str?: string; hasEOL?: boolean }>);
      pages.push({
        index: i,
        text,
        blocks: text.trim() ? [{ type: 'text', x: 0, y: 0, width: 0, height: 0, text: text.trim() }] : [],
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  const structure = deriveStructure(pages, `pdf-${simpleHash(pages.map((p) => p.text ?? '').join(''))}`);
  const wordCount = pages.reduce((sum, p) => sum + (p.text?.match(/\S+/g)?.length ?? 0), 0);
  return { pages, structure, format: 'pdf', wordCount };
}

/** Reassemble pdfjs text items into readable lines. */
function pdfItemsToString(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  let out = '';
  for (const item of items) {
    const s = item.str ?? '';
    if (!s) continue;
    if (out && !out.endsWith('\n') && !out.endsWith(' ')) out += ' ';
    out += s;
    if (item.hasEOL) out += '\n';
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------
// DOCX parsing — minimal ZIP central-directory reader + deflate-raw inflation.
// No dependency needed: the browser's DecompressionStream does the inflate.
// ---------------------------------------------------------------------------

async function parseDocx(buffer: ArrayBuffer): Promise<ParsedFileResult> {
  const bytes = new Uint8Array(buffer);
  const xml = await readZipTextEntry(bytes, 'word/document.xml');
  if (!xml) {
    // Not a valid docx package — try plain-text decode as a last resort.
    const text = sanitizeText(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
    if (text) return parseText(text, 'docx');
    return { pages: [], structure: emptyStructure(), format: 'docx', wordCount: 0 };
  }
  return parseText(docxXmlToText(xml), 'docx');
}

/** Convert word/document.xml into plain text (paragraphs become newlines). */
function docxXmlToText(xml: string): string {
  return xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8)) >>> 0;
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function decodeName(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/** Locate a case-insensitive entry inside a (stored or deflated) ZIP. */
async function readZipTextEntry(bytes: Uint8Array, targetName: string): Promise<string | undefined> {
  const len = bytes.length;
  if (len < 22) return undefined;

  // Scan backwards for End Of Central Directory.
  const maxScan = Math.min(len, 65557);
  let eocd = -1;
  for (let i = len - maxScan; i <= len - 22 && eocd === -1; i++) {
    if (u32(bytes, i) === EOCD_SIG) eocd = i;
  }
  if (eocd === -1) return undefined;

  const entryCount = u16(bytes, eocd + 10);
  let cursor = u32(bytes, eocd + 16);
  const target = targetName.toLowerCase();

  for (let n = 0; n < entryCount; n++) {
    if (cursor + 46 > len || u32(bytes, cursor) !== CEN_SIG) break;
    const method = u16(bytes, cursor + 10);
    const compSize = u32(bytes, cursor + 20);
    const nameLen = u16(bytes, cursor + 28);
    const extraLen = u16(bytes, cursor + 30);
    const commentLen = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const name = decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLen));

    if (name.toLowerCase() === target) {
      if (localOffset + 30 > len) return undefined;
      const locNameLen = u16(bytes, localOffset + 26);
      const locExtraLen = u16(bytes, localOffset + 28);
      const dataStart = localOffset + 30 + locNameLen + locExtraLen;
      const data = bytes.subarray(dataStart, dataStart + compSize);
      if (method === 0) return decodeName(data);
      if (method === 8) return inflateRaw(data);
      return undefined;
    }
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return undefined;
}

async function inflateRaw(data: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view (subarray may share a larger buffer).
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const inflated = await new Response(stream).arrayBuffer();
  return new TextDecoder('utf-8').decode(inflated);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit — deterministic, stable across sessions (cache keys). */
function simpleHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
