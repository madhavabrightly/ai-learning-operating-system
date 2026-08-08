import { ok, err } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import type { IEventBus } from '@/events/types';
import { EventTopics } from '@/events/EventTopics';
import type { ILogger } from '@/logging/ILogger';
import type { Concept, ConceptId, IGraphService, KnowledgeGraph, ConceptRelationship } from '../types/GraphTypes';
import type { DocumentService } from '@/modules/document/service/DocumentService';

export interface GraphExtractionResult {
  concepts: Concept[];
  relationships: ConceptRelationship[];
  fallback: 'ai' | 'heuristic';
}

export interface GraphExtractor {
  extract(documentId: string, text: string): Promise<GraphExtractionResult>;
}

export interface GraphServiceOptions {
  extractor: GraphExtractor;
  persist?: boolean;
}

export class GraphService implements IGraphService {
  private graphs = new Map<string, KnowledgeGraph>();

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly documentService: DocumentService,
    private readonly options: GraphServiceOptions,
  ) {}

  async load(documentId: string): Promise<Result<KnowledgeGraph>> {
    // Prefer an already-built graph for this document.
    const existing = this.graphs.get(documentId);
    if (existing) {
      this.eventBus.publish(EventTopics.CONCEPTS_EXTRACTED, { documentId, concepts: existing.concepts }, 'client');
      return ok(existing);
    }

    // Build a real graph from real document content.
    const docResult = await this.documentService.getDocument(documentId);
    if (!docResult.success || !docResult.data) {
      return err(`Document ${documentId} not found — cannot extract concepts`);
    }
    const doc = docResult.data;
    const text = doc.pages.map((p) => p.text).join('\n').slice(0, 60_000);

    if (!text.trim()) {
      return ok({ concepts: [], relationships: [] });
    }

    try {
      const extraction = await this.options.extractor.extract(documentId, text);
      const graph: KnowledgeGraph = {
        concepts: extraction.concepts.map((c) => ({
          ...c,
          sourceDocumentId: documentId,
          sourcePage: c.sourcePage ?? 0,
        })),
        relationships: extraction.relationships,
      };
      this.graphs.set(documentId, graph);
      this.eventBus.publish(EventTopics.CONCEPTS_EXTRACTED, { documentId, concepts: graph.concepts, fallback: extraction.fallback }, 'client');
      this.logger.info('Graph built from content', { documentId, concepts: graph.concepts.length, fallback: extraction.fallback });
      return ok(graph);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error('Graph extraction failed', { documentId, error: message });
      return err(message);
    }
  }

  async search(query: string): Promise<Result<Concept[]>> {
    const q = query.toLowerCase();
    const all = [...this.graphs.values()].flatMap((g) => g.concepts);
    return ok(all.filter((c) => c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)));
  }

  async selectConcept(conceptId: ConceptId): Promise<Result<Concept>> {
    const all = [...this.graphs.values()].flatMap((g) => g.concepts);
    const concept = all.find((c) => c.id === conceptId);
    if (!concept) return { success: false, error: `Concept ${conceptId} not found`, retryable: false, fallbackAvailable: false };
    this.eventBus.publish(EventTopics.CONCEPT_SELECTED, { conceptId, concept }, 'client');
    return ok(concept);
  }

  async getRelated(conceptId: ConceptId): Promise<Result<{ prerequisites: Concept[]; related: Concept[] }>> {
    const graph = [...this.graphs.values()].find((g) => g.concepts.some((c) => c.id === conceptId));
    if (!graph) return ok({ prerequisites: [], related: [] });
    const prereqIds = graph.relationships.filter((r) => r.target === conceptId && r.type === 'prerequisite').map((r) => r.source);
    const relatedIds = graph.relationships
      .filter((r) => (r.source === conceptId || r.target === conceptId) && r.type !== 'prerequisite')
      .map((r) => (r.source === conceptId ? r.target : r.source));
    const byId = new Map(graph.concepts.map((c) => [c.id, c]));
    return ok({
      prerequisites: prereqIds.map((id) => byId.get(id)).filter((c): c is Concept => Boolean(c)),
      related: relatedIds.map((id) => byId.get(id)).filter((c): c is Concept => Boolean(c)),
    });
  }

  /** Cache-clear on document delete. */
  forget(documentId: string): void {
    this.graphs.delete(documentId);
  }
}
