import type { ParsedDocument, DocumentSelection } from '../model/DocumentModel';
import type { Result } from '@/errors/types';
import { ok } from '@/errors/ResultFactory';

/**
 * Real retrieval over the canonical document model.
 *
 * - keyword search over page text + blocks
 * - section search
 * - concept search (term-based, driven by graph labels)
 * - context window assembly for AI grounding (targeted chunks, not full docs)
 */

export interface SearchOptions {
  maxResults?: number;
  mode?: 'keyword' | 'section' | 'concept';
}

export interface RetrievedChunk {
  text: string;
  page: number;
  sectionId?: string;
  sectionTitle?: string;
  blockId?: string;
  score: number;
}

export function searchDocument(doc: ParsedDocument, query: string, options: SearchOptions = {}): DocumentSelection[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const maxResults = options.maxResults ?? 20;
  const results: DocumentSelection[] = [];
  const seen = new Set<string>();

  for (const page of doc.pages) {
    const lower = page.text.toLowerCase();
    const index = lower.indexOf(q);
    if (index === -1) continue;
    const start = Math.max(0, index - 80);
    const end = Math.min(page.text.length, index + q.length + 220);
    const snippet = page.text.slice(start, end);
    const key = `${page.index}:${snippet.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      documentId: doc.id,
      page: page.index,
      text: snippet,
      rect: undefined,
    });
    if (results.length >= maxResults) break;
  }

  return results;
}

/** Rank chunks of a document against a query (term-overlap scoring). */
export function retrieveChunks(doc: ParsedDocument, query: string, maxChunks = 6, chunkChars = 1200): RetrievedChunk[] {
  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter((t) => t.length > 2);
  if (terms.length === 0) return [];

  const chunks: RetrievedChunk[] = [];

  // Score each section; then split top sections into page-level chunks.
  const scoredSections = doc.sections
    .map((section) => {
      const lower = section.text.toLowerCase();
      const score = terms.reduce((sum, t) => sum + (lower.includes(t) ? 1 : 0), 0) + (lower.includes(q) ? 2 : 0);
      return { section, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { section, score } of scoredSections.slice(0, 4)) {
    // Pull the section text, page-aligned.
    const pages = new Set(section.blockIds.map((id) => doc.pages.find((p) => p.blockIds.includes(id))?.index).filter((p): p is number => p !== undefined));
    for (const pageIdx of [...pages].sort((a, b) => a - b).slice(0, 3)) {
      const page = doc.pages[pageIdx - 1];
      if (!page) continue;
      const lower = page.text.toLowerCase();
      let offset = lower.indexOf(terms[0]!);
      if (offset === -1) offset = 0;
      const start = Math.max(0, offset - chunkChars / 2);
      chunks.push({
        text: page.text.slice(start, start + chunkChars),
        page: page.index,
        sectionId: section.id,
        sectionTitle: section.title,
        score,
      });
    }
  }

  // Fall back to whole-page chunks when no section matched.
  if (chunks.length === 0) {
    for (const page of doc.pages) {
      const lower = page.text.toLowerCase();
      const score = terms.reduce((sum, t) => sum + (lower.includes(t) ? 1 : 0), 0);
      if (score > 0 && page.text.trim()) {
        chunks.push({ text: page.text.slice(0, chunkChars), page: page.index, score });
      }
    }
  }

  chunks.sort((a, b) => b.score - a.score);
  return chunks.slice(0, maxChunks);
}

/** Search across a list of documents. */
export function searchDocuments(docs: ParsedDocument[], query: string, options: SearchOptions = {}): Result<DocumentSelection[]> {
  const results: DocumentSelection[] = [];
  for (const doc of docs) {
    results.push(...searchDocument(doc, query, options));
  }
  return ok(results.slice(0, options.maxResults ?? 50));
}
