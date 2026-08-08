import mammoth from 'mammoth/mammoth.browser';
import type { ParserOutput, RawBlock } from '../model/normalizer';

export interface DocxParseOptions {
  onProgress?: (fraction: number, message?: string) => void;
}

/**
 * Parse a real .docx file. Uses mammoth to convert to HTML, then converts the
 * HTML DOM into raw blocks — preserving real tables (headers + rows).
 */
export async function parseDocxFile(file: File, options: DocxParseOptions = {}): Promise<ParserOutput> {
  options.onProgress?.(0.1, 'Reading DOCX…');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });

  const html = result.value;
  const warnings = result.messages;
  void warnings;

  // Parse the HTML into blocks using a real DOM parser.
  const blocks: RawBlock[] = [];
  const tables: NonNullable<ParserOutput['tables']> = [];

  const doc = new DOMParser().parseFromString(html, 'text/html');
  walkDom(doc.body, blocks, tables, 0);

  options.onProgress?.(0.9, 'Extracting structure…');

  const title = file.name.replace(/\.docx$/i, '');

  return {
    title,
    format: 'docx',
    pages: [
      {
        index: 1,
        text: blocksToText(blocks),
        blocks,
      },
    ],
    tables: tables.length > 0 ? tables : undefined,
    parserEngine: 'mammoth',
  };
}

function blocksToText(blocks: RawBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'heading') return b.text ?? '';
      if (b.type === 'list') return (b.items ?? []).map((it) => `- ${it}`).join('\n');
      if (b.type === 'table') return '[table]';
      return b.text ?? '';
    })
    .join('\n');
}

function walkDom(
  node: Element,
  blocks: RawBlock[],
  tables: NonNullable<ParserOutput['tables']>,
  depth: number,
): void {
  if (depth > 12) return;

  for (const child of Array.from(node.children)) {
    const tag = child.tagName.toLowerCase();

    if (tag === 'table') {
      const parsed = parseTableElement(child);
      if (parsed) {
        tables.push(parsed.table);
        blocks.push({ type: 'table', confidence: parsed.confidence });
      }
      continue;
    }

    if (tag === 'img') {
      const src = child.getAttribute('src');
      if (src) {
        blocks.push({ type: 'image', text: 'Image', imageUrl: src, confidence: 0.8 });
      }
      continue;
    }

    if (tag === 'p' || tag === 'div') {
      const text = child.textContent?.trim();
      if (text) {
        const isHeadingLike = /^(\d+\.?\s+)?[A-Z][^a-z]{0,60}$/.test(text) && text.length < 80;
        blocks.push({
          type: isHeadingLike ? 'heading' : 'text',
          text,
          headingLevel: isHeadingLike ? 2 : undefined,
          confidence: 0.8,
        });
      }
      continue;
    }

    if (/^h[1-6]$/.test(tag)) {
      const text = child.textContent?.trim();
      if (text) {
        blocks.push({ type: 'heading', text, headingLevel: Number(tag[1]), confidence: 0.9 });
      }
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      const items: string[] = [];
      for (const li of Array.from(child.querySelectorAll(':scope > li'))) {
        const text = li.textContent?.trim();
        if (text) items.push(text);
      }
      if (items.length > 0) {
        blocks.push({ type: 'list', items, ordered: tag === 'ol', confidence: 0.9 });
      }
      continue;
    }

    // Recurse into containers.
    walkDom(child, blocks, tables, depth + 1);
  }
}

interface ParsedTable {
  table: NonNullable<ParserOutput['tables']>[number];
  confidence: number;
}

function parseTableElement(tableEl: Element): ParsedTable | null {
  const rowsEls = Array.from(tableEl.querySelectorAll('tr'));
  if (rowsEls.length === 0) return null;

  const grid: string[][] = rowsEls.map((tr) =>
    Array.from(tr.querySelectorAll('th, td')).map((cell) => cell.textContent?.trim() ?? ''),
  );

  if (grid.length === 0 || grid[0]!.length === 0) return null;

  const isHeaderRow = (row: string[]): boolean => row.every((c) => c.length > 0 && c.length < 60);
  const headers = isHeaderRow(grid[0] ?? []) ? (grid[0] ?? []) : [];
  const rows = headers.length > 0 ? grid.slice(1) : grid;

  return {
    table: {
      page: 1,
      caption: undefined,
      headers,
      rows,
      confidence: 0.85,
    },
    confidence: 0.85,
  };
}
