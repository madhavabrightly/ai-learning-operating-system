import * as pdfjsLib from 'pdfjs-dist';
import type { ParserOutput, RawBlock, RawFigure, RawTable } from '../model/normalizer';

// PDF.js worker — Vite resolves the ?url import to a real asset URL.
// eslint-disable-next-line import/default
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfParseOptions {
  onProgress?: (page: number, total: number, message?: string) => void;
  onPageProgress?: (page: number, total: number, message?: string) => void;
  /** Render figures as data URLs up to this pixel dimension. */
  maxFigureSize?: number;
  /** Rasterize figure regions (can be slow for large PDFs). */
  extractFigures?: boolean;
}

export interface PdfImageCandidate {
  page: number;
  bbox: { x: number; y: number; width: number; height: number };
  dataUrl?: string;
}

/**
 * Parse a real PDF file into raw parser output. Extracts text items with
 * positions, headings by font heuristic, tables from grid-like text regions,
 * and figures from embedded images / captions. Page-by-page with progress so
 * callers can surface PARTIAL results when a page fails.
 */
export async function parsePdfFile(file: File, options: PdfParseOptions = {}): Promise<ParserOutput> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  const pages: ParserOutput['pages'] = [];
  const tables: RawTable[] = [];
  const figures: RawFigure[] = [];
  const total = pdf.numPages;

  for (let pageIndex = 1; pageIndex <= total; pageIndex++) {
    options.onProgress?.(pageIndex, total, `Parsing page ${pageIndex}/${total}`);
    options.onPageProgress?.(pageIndex, total, `Parsing page ${pageIndex}/${total}`);
    const page = await pdf.getPage(pageIndex);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    const items: { str: string; x: number; y: number; width: number; height: number; hasEOL: boolean; fontSize?: number }[] = [];

    let rawText = '';
    for (const item of textContent.items) {
      if ('str' in item) {
        const it = item as { str: string; transform: number[]; width: number; height: number; hasEOL: boolean };
        const x = it.transform[4] ?? 0;
        const y = it.transform[5] ?? 0;
        const fontSize = Math.hypot(it.transform[2] ?? 0, it.transform[3] ?? 0) || undefined;
        items.push({ str: it.str, x, y, width: it.width, height: it.height, hasEOL: it.hasEOL, fontSize });
        rawText += it.str;
        if (it.hasEOL) rawText += '\n';
      }
    }

    // Sort items by reading order: top-to-bottom, then left-to-right.
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    const blocks = classifyItems(items);
    const extractedTables = extractTablesFromItems(items, pageIndex);
    tables.push(...extractedTables);

    if (options.extractFigures !== false) {
      const pageFigures = await extractPageFigures(page, pageIndex, options.maxFigureSize ?? 1200);
      figures.push(...pageFigures);
    }

    pages.push({
      index: pageIndex,
      text: rawText.replace(/\n{3,}/g, '\n\n').trim(),
      blocks,
      width: viewport.width,
      height: viewport.height,
    });
  }

  return {
    title: file.name.replace(/\.pdf$/i, ''),
    format: 'pdf',
    pages,
    tables: tables.length > 0 ? tables : undefined,
    figures: figures.length > 0 ? figures : undefined,
    parserEngine: `pdfjs-dist-${pdfjsLib.version}`,
  };
}

const HEADING_FONT_SIZES = new Set<number>([16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 32, 34, 36]);

function classifyItems(
  items: { str: string; x: number; y: number; width: number; height: number; fontSize?: number }[],
): RawBlock[] {
  const blocks: RawBlock[] = [];
  const para: string[] = [];
  let lastY: number | undefined;

  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join(' ');
    if (!text.trim()) {
      para.length = 0;
      return;
    }
    blocks.push({ type: 'text', text: text.trim(), confidence: 0.7 });
    para.length = 0;
  };

  for (const item of items) {
    const str = item.str.trim();
    if (!str) continue;
    const isNewLine = lastY !== undefined && Math.abs(item.y - lastY) > item.height * 0.5;

    // Heading heuristic: larger font, short line.
    if (item.fontSize && HEADING_FONT_SIZES.has(Math.round(item.fontSize)) && str.length < 120) {
      flushPara();
      blocks.push({ type: 'heading', text: str, headingLevel: item.fontSize >= 24 ? 1 : 2, confidence: 0.6, bbox: { x: item.x, y: item.y, width: item.width, height: item.height } });
      lastY = item.y;
      continue;
    }

    if (isNewLine) {
      flushPara();
    }
    para.push(str);
    lastY = item.y;
  }
  flushPara();

  return blocks;
}

/** Heuristic table extraction from positioned text: find rows sharing a y-band. */
function extractTablesFromItems(
  items: { str: string; x: number; y: number; width: number; height: number; fontSize?: number }[],
  page: number,
): RawTable[] {
  const rows = new Map<number, { y: number; cells: { x: number; text: string }[] }>();
  for (const item of items) {
    const str = item.str.trim();
    if (!str) continue;
    const yKey = Math.round(item.y / 4) * 4;
    const row = rows.get(yKey) ?? { y: item.y, cells: [] };
    row.cells.push({ x: item.x, text: str });
    rows.set(yKey, row);
  }

  const sortedRows = [...rows.values()].sort((a, b) => b.y - a.y);
  const candidates: RawTable[] = [];

  // Look for runs of 3+ consecutive rows with 2+ cells each.
  for (let i = 0; i < sortedRows.length; i++) {
    const row = sortedRows[i]!;
    if (row.cells.length < 2) continue;
    const grid: string[][] = [];
    let j = i;
    while (j < sortedRows.length && sortedRows[j]!.cells.length >= 2 && j - i < 50) {
      const cells = sortedRows[j]!.cells.sort((a, b) => a.x - b.x).map((c) => c.text);
      grid.push(cells);
      j++;
    }
    if (grid.length >= 3) {
      const header = grid[0] ?? [];
      candidates.push({ page, headers: header, rows: grid.slice(1), confidence: 0.55 });
      i = j - 1;
    }
  }

  return candidates.slice(0, 3);
}

async function extractPageFigures(page: import('pdfjs-dist').PDFPageProxy, pageIndex: number, maxSize: number): Promise<RawFigure[]> {
  const figures: RawFigure[] = [];
  try {
    const ops = await page.getOperatorList();
    const commonObjs = page.commonObjs;
    const candidates: PdfImageCandidate[] = [];

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      // PDFImage is drawn via paintImageXObject; the name is in argsArray.
      if (fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintImageXObjectRepeat) {
        const args = ops.argsArray[i] ?? [];
        const name = String(args[0] ?? '');
        const obj = commonObjs?.get(name);
        if (obj && 'width' in obj && 'height' in obj) {
          const w = Number((obj as { width: number }).width);
          const h = Number((obj as { height: number }).height);
          if (w > 40 && h > 40) {
            candidates.push({ page: pageIndex, bbox: { x: 0, y: 0, width: w, height: h } });
          }
        }
      }
    }

    for (let i = 0; i < Math.min(candidates.length, 5); i++) {
      const cand = candidates[i]!;
      try {
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(maxSize / viewport.width, 2, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * scale);
        canvas.height = Math.floor(viewport.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        await page.render({ canvas, canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise;
        figures.push({
          page: pageIndex,
          caption: `Figure ${i + 1} (page ${pageIndex})`,
          bbox: cand.bbox,
          imageUrl: canvas.toDataURL('image/png'),
          confidence: 0.5,
        });
      } catch {
        // Rasterization failed — keep the placeholder region.
        figures.push({
          page: pageIndex,
          caption: `Figure region (page ${pageIndex})`,
          bbox: cand.bbox,
          confidence: 0.3,
        });
      }
    }
  } catch {
    // Figure extraction is best-effort; never fail the page parse.
  }
  return figures;
}
