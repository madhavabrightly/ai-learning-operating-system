import type { GraphExtractor, GraphExtractionResult } from './GraphService';

export interface BackendClient {
  post(path: string, body: unknown): Promise<unknown>;
}

export interface AiExtractResponse {
  concepts?: {
    id: string;
    label: string;
    description?: string;
    difficulty?: string;
    sourcePage?: number;
    example?: string;
  }[];
  relationships?: { source: string; target: string; type: string; reason?: string }[];
  fallback?: 'ai' | 'heuristic';
}

const VALID_TYPES = ['prerequisite', 'related', 'part_of', 'leads_to'] as const;

function sanitizeRelationships(raw: AiExtractResponse['relationships']): GraphExtractionResult['relationships'] {
  return (raw ?? [])
    .filter((r) => r.source && r.target && (VALID_TYPES as readonly string[]).includes(r.type))
    .map((r) => ({
      id: `rel-${r.source}-${r.target}`,
      source: r.source,
      target: r.target,
      type: r.type as (typeof VALID_TYPES)[number],
      strength: 0.7,
    }));
}

/**
 * Real concept extraction: asks the backend for AI extraction, falls back to
 * deterministic heuristics when the AI is unconfigured or fails. Concepts
 * always originate from actual document content with provenance.
 */
export function createBackendGraphExtractor(client: BackendClient): GraphExtractor {
  return {
    async extract(documentId: string, text: string): Promise<GraphExtractionResult> {
      const response = (await client.post('/api/ai/extract', {
        documentId,
        text,
      })) as AiExtractResponse & { error?: { code: string; message: string } };

      if (response.error) {
        // Backend failed (e.g., transport). Fall back to heuristic locally.
        return heuristicExtract(documentId, text);
      }

      const concepts = (response.concepts ?? [])
        .filter((c) => c.id && c.label)
        .map((c) => ({
          id: c.id,
          label: c.label,
          description: c.description,
          difficulty: (c.difficulty ?? 'beginner') as Concept['difficulty'],
          sourcePage: c.sourcePage ?? 0,
          example: c.example,
        }));

      if (concepts.length === 0) {
        return heuristicExtract(documentId, text);
      }

      return {
        concepts,
        relationships: sanitizeRelationships(response.relationships),
        fallback: response.fallback === 'heuristic' ? 'heuristic' : 'ai',
      };
    },
  };
}

import type { Concept } from '../types/GraphTypes';

/** Deterministic fallback: term frequency + first-mention sentence. */
export function heuristicExtract(documentId: string, text: string): GraphExtractionResult {
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

  const tokens = text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];
  const freq = new Map<string, number>();
  for (const t of tokens) {
    if (STOP.has(t)) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }

  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

  const concepts: Concept[] = ranked.map(([term], i) => {
    const sentence = sentences.find((s) => s.toLowerCase().includes(term)) ?? '';
    return {
      id: `${documentId}-concept-${i + 1}`,
      label: term.replace(/-/g, ' '),
      description: sentence ? `Discussed in the text: "${sentence.slice(0, 200)}"` : `Frequent term in this document.`,
      difficulty: 'beginner',
      sourcePage: 0,
    };
  });

  return { concepts, relationships: [], fallback: 'heuristic' };
}
