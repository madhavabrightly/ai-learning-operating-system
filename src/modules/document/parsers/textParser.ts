import type { ParserOutput, RawBlock } from '../model/normalizer';

export interface TextParseOptions {
  format?: 'txt' | 'markdown';
  title?: string;
}

function isMarkdownTableRow(line: string): boolean {
  // Pipe-separated row: "| a | b |"
  return line.startsWith('|') && line.includes('|') && line.split('|').length >= 3;
}

function isMarkdownSeparatorRow(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
}

function parseMarkdown(text: string): { blocks: RawBlock[]; tables: ParserOutput['tables'] } {
  const lines = text.split('\n');
  const blocks: RawBlock[] = [];
  const tables: NonNullable<ParserOutput['tables']> = [];
  let i = 0;

  // Collect contiguous paragraphs for text blocks.
  const para: string[] = [];
  const flushPara = () => {
    if (para.length === 0) return;
    const content = para.join('\n');
    if (content.trim()) blocks.push({ type: 'text', text: content.trim(), confidence: 0.9 });
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Code fence
    if (/^```/.test(trimmed)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i] ?? '')) {
        code.push(lines[i] ?? '');
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: 'code', text: code.join('\n'), confidence: 1 });
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(trimmed)) {
      flushPara();
      blocks.push({ type: 'quote', text: trimmed.replace(/^>\s?/, ''), confidence: 0.9 });
      i++;
      continue;
    }

    // Headings
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      blocks.push({ type: 'heading', text: (heading[2] ?? '').trim(), headingLevel: heading[1]?.length ?? 1, confidence: 1 });
      i++;
      continue;
    }

    // Table: header, separator, rows
    if (isMarkdownTableRow(trimmed) && i + 1 < lines.length && isMarkdownSeparatorRow(lines[i + 1] ?? '')) {
      flushPara();
      const header = parseMdRow(trimmed);
      const rows: string[][] = [];
      i += 2; // skip header + separator
      while (i < lines.length && isMarkdownTableRow(lines[i] ?? '')) {
        rows.push(parseMdRow(lines[i] ?? ''));
        i++;
      }
      tables.push({ page: 1, headers: header, rows, confidence: 0.9 });
      blocks.push({ type: 'table', confidence: 0.9 });
      continue;
    }

    // List item
    if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(trimmed)) {
      flushPara();
      const ordered = /^\s*\d+/.test(trimmed);
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? '';
        const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(l);
        if (!m) break;
        items.push(m[1] ?? '');
        i++;
      }
      blocks.push({ type: 'list', items, ordered, confidence: 0.9 });
      continue;
    }

    // Horizontal rule
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      flushPara();
      i++;
      continue;
    }

    // Blank line → paragraph boundary
    if (!trimmed) {
      flushPara();
      i++;
      continue;
    }

    para.push(trimmed);
    i++;
  }
  flushPara();

  return { blocks, tables };
}

function parseMdRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function parsePlainText(text: string): RawBlock[] {
  const lines = text.split('\n');
  const blocks: RawBlock[] = [];
  const para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      const content = para.join('\n');
      if (content.trim()) blocks.push({ type: 'text', text: content.trim(), confidence: 0.85 });
      para.length = 0;
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)) {
      flush();
      const items: string[] = [];
      items.push(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''));
      // consume following list items at same level
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

/** Parse plain text or markdown into raw parser output. */
export function parseText(text: string, options: TextParseOptions = {}): ParserOutput {
  const format = options.format ?? 'txt';
  const title = options.title ?? inferTitle(text);

  if (format === 'markdown' || looksLikeMarkdown(text)) {
    const { blocks, tables } = parseMarkdown(text);
    return {
      title,
      format: 'markdown',
      pages: [{ index: 1, text, blocks }],
      tables,
      parserEngine: 'text-markdown',
    };
  }

  return {
    title,
    format: 'txt',
    pages: [{ index: 1, text, blocks: parsePlainText(text) }],
    parserEngine: 'text-plain',
  };
}

function looksLikeMarkdown(text: string): boolean {
  return /#{1,6}\s|^\s*(?:[-*•]|\d+[.)])\s+|\|.*\|/m.test(text.slice(0, 10_000));
}

function inferTitle(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? 'Untitled';
  return firstLine.slice(0, 200) || 'Untitled document';
}

/** Extract a plain-text summary of a ParsedDocument for context building. */
export function truncateForContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n…[truncated]';
}
