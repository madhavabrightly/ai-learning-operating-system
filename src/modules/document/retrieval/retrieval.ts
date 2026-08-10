import type { ParsedDocument, DocumentPage, Formula, Table } from '../model/DocumentModel';

export interface RetrievedChunk {
  page: number;
  text: string;
  sectionTitle?: string;
  score: number;
}

/**
 * Simple retrieval over the canonical document model: scores pages/sections by
 * query term overlap and returns the top-k chunks, each capped at maxChars.
 */
export function retrieveChunks(
  doc: ParsedDocument,
  query: string,
  count = 4,
  maxChars = 1500,
): RetrievedChunk[] {
  const terms = tokenize(query);
  if (terms.length === 0) {
    return doc.pages.slice(0, count).map((p) => ({ page: p.index, text: excerpt(p.text, maxChars), score: 0 }));
  }

  const candidates: RetrievedChunk[] = [];

  for (const page of doc.pages) {
    const pageText = pageTextOf(doc, page);
    const score = scoreText(pageText, terms);
    if (score > 0) {
      candidates.push({ page: page.index, text: excerpt(pageText, maxChars), score });
    }
  }

  // Section-level candidates (better for long pages).
  for (const section of doc.sections) {
    const score = scoreText(section.text, terms);
    if (score > 0) {
      candidates.push({
        page: section.page,
        text: excerpt(section.text, maxChars),
        sectionTitle: section.title,
        score: score + 1,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, count);
}

function pageTextOf(doc: ParsedDocument, page: DocumentPage): string {
  const blocks = page.blocks?.map((b) => b.text ?? '').join('\n') ?? '';
  return page.text || blocks;
}

function scoreText(text: string, terms: string[]): number {
  const haystack = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const idx = haystack.indexOf(term);
    if (idx >= 0) {
      score += 1 + (haystack.length > 400 ? 0.5 : 0);
    }
  }
  return score;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9'’-]+/)
    .filter((t) => t.length > 1)
    .slice(0, 12);
}

function excerpt(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > maxChars * 0.6 ? lastSpace : maxChars)}…`;
}
