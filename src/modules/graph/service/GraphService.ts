```ts
import { ok } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import type { IEventBus } from '@/events/types';
import { EventTopics } from '@/events/EventTopics';
import type { ILogger } from '@/logging/ILogger';
import type { DocumentService } from '@/modules/document/service/DocumentService';
import type { GraphExtractor } from './BackendGraphExtractor';
import type {
  Concept,
  ConceptId,
  IGraphService,
  KnowledgeGraph,
} from '../types/GraphTypes';

/**
 * Production-grade graph service.
 *
 * Responsibilities:
 * - Document-scoped graph management
 * - Backend graph extraction
 * - Graph caching
 * - Concept normalization/deduplication
 * - Fast relationship lookups
 * - Search
 * - Prerequisite traversal
 * - Related concept discovery
 * - Learning recommendations
 * - Graph statistics
 * - Safe refresh/invalidation
 * - Concurrent load protection
 */
export class GraphService implements IGraphService {
  private readonly graphs = new Map<string, KnowledgeGraph>();

  /**
   * Fast indexes.
   */
  private readonly conceptsById = new Map<string, Map<ConceptId, Concept>>();

  private readonly outgoing = new Map<
    string,
    Map<ConceptId, KnowledgeGraph['relationships']>
  >();

  private readonly incoming = new Map<
    string,
    Map<ConceptId, KnowledgeGraph['relationships']>
  >();

  /**
   * Prevent duplicate backend extraction requests when multiple UI
   * components request the same document simultaneously.
   */
  private readonly loading = new Map<string, Promise<Result<KnowledgeGraph>>>();

  private readonly extractor?: GraphExtractor;

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    _documentService?: DocumentService,
    options?: {
      extractor?: GraphExtractor;
    },
  ) {
    this.extractor = options?.extractor;
  }

  // ---------------------------------------------------------------------------
  // LOAD
  // ---------------------------------------------------------------------------

  async load(documentId: string): Promise<Result<KnowledgeGraph>> {
    if (!documentId?.trim()) {
      return this.fail('Document ID is required');
    }

    const cached = this.graphs.get(documentId);

    if (cached) {
      this.publishLoaded(documentId, cached);
      return ok(cached);
    }

    const existingLoad = this.loading.get(documentId);

    if (existingLoad) {
      return existingLoad;
    }

    const promise = this.extractGraph(documentId);

    this.loading.set(documentId, promise);

    try {
      return await promise;
    } finally {
      this.loading.delete(documentId);
    }
  }

  private async extractGraph(
    documentId: string,
  ): Promise<Result<KnowledgeGraph>> {
    let graph: KnowledgeGraph | undefined;

    if (this.extractor) {
      try {
        const extracted = await this.extractor.extract(documentId);

        if (extracted.success && extracted.data) {
          graph = this.normalizeGraph(extracted.data, documentId);
        } else {
          this.logger.warn?.('Graph extraction failed', {
            documentId,
            error: extracted.error,
          });
        }
      } catch (error) {
        this.logger.warn?.('Graph extractor threw an exception', {
          documentId,
          error,
        });
      }
    }

    /**
     * Important:
     *
     * Do NOT silently create fake educational data in production.
     * Returning an empty graph is safer than showing unrelated concepts
     * from another document.
     */
    if (!graph) {
      graph = this.emptyGraph(documentId);
    }

    this.setGraph(documentId, graph);

    this.publishLoaded(documentId, graph);

    this.logger.info('Graph loaded', {
      documentId,
      concepts: graph.concepts.length,
      relationships: graph.relationships.length,
    });

    return ok(graph);
  }

  // ---------------------------------------------------------------------------
  // SEARCH
  // ---------------------------------------------------------------------------

  async search(query: string): Promise<Result<Concept[]>> {
    const q = query.trim().toLowerCase();

    if (!q) {
      return ok([]);
    }

    const concepts = [...this.conceptsById.values()].flatMap((map) =>
      [...map.values()],
    );

    const scored = concepts
      .map((concept) => ({
        concept,
        score: this.scoreSearch(concept, q),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return ok(scored.map((item) => item.concept));
  }

  private scoreSearch(concept: Concept, query: string): number {
    const label = concept.label.toLowerCase();
    const description = concept.description?.toLowerCase() ?? '';

    let score = 0;

    if (label === query) score += 100;
    if (label.startsWith(query)) score += 60;
    if (label.includes(query)) score += 40;
    if (description.includes(query)) score += 15;

    /**
     * Slightly prioritize concepts with lower mastery because they are
     * more useful to a learning-oriented search.
     */
    if (typeof concept.mastery === 'number') {
      score += (1 - concept.mastery) * 5;
    }

    return score;
  }

  // ---------------------------------------------------------------------------
  // CONCEPT SELECTION
  // ---------------------------------------------------------------------------

  async selectConcept(conceptId: ConceptId): Promise<Result<Concept>> {
    const concept = this.findConcept(conceptId);

    if (!concept) {
      return this.fail(`Concept ${conceptId} not found`);
    }

    this.eventBus.publish(
      EventTopics.CONCEPT_SELECTED,
      {
        conceptId,
        concept,
      },
      'client',
    );

    return ok(concept);
  }

  // ---------------------------------------------------------------------------
  // RELATIONSHIPS
  // ---------------------------------------------------------------------------

  async getRelated(
    conceptId: ConceptId,
  ): Promise<
    Result<{
      prerequisites: Concept[];
      related: Concept[];
    }>
  > {
    const graphId = this.findGraphId(conceptId);

    if (!graphId) {
      return ok({
        prerequisites: [],
        related: [],
      });
    }

    const graph = this.graphs.get(graphId);

    if (!graph) {
      return ok({
        prerequisites: [],
        related: [],
      });
    }

    const byId = this.conceptsById.get(graphId);

    if (!byId) {
      return ok({
        prerequisites: [],
        related: [],
      });
    }

    const relationships = [
      ...(this.outgoing.get(graphId)?.get(conceptId) ?? []),
      ...(this.incoming.get(graphId)?.get(conceptId) ?? []),
    ];

    const prerequisiteIds = new Set<ConceptId>();
    const relatedIds = new Set<ConceptId>();

    for (const relationship of relationships) {
      if (
        relationship.type === 'prerequisite' &&
        relationship.target === conceptId
      ) {
        prerequisiteIds.add(relationship.source);
      } else if (relationship.type !== 'prerequisite') {
        const other =
          relationship.source === conceptId
            ? relationship.target
            : relationship.source;

        if (other !== conceptId) {
          relatedIds.add(other);
        }
      }
    }

    return ok({
      prerequisites: [...prerequisiteIds]
        .map((id) => byId.get(id))
        .filter((c): c is Concept => Boolean(c)),

      related: [...relatedIds]
        .map((id) => byId.get(id))
        .filter((c): c is Concept => Boolean(c)),
    });
  }

  // ---------------------------------------------------------------------------
  // PREREQUISITES
  // ---------------------------------------------------------------------------

  /**
   * Returns ALL prerequisite concepts recursively.
   *
   * Example:
   *
   * Binary Search
   *   -> Sorted Array
   *   -> Logarithm
   *        -> Exponentiation
   */
  async getPrerequisites(
    conceptId: ConceptId,
    depth = Infinity,
  ): Promise<Result<Concept[]>> {
    const graphId = this.findGraphId(conceptId);

    if (!graphId) {
      return ok([]);
    }

    const byId = this.conceptsById.get(graphId);

    if (!byId) {
      return ok([]);
    }

    const incoming = this.incoming.get(graphId);

    if (!incoming) {
      return ok([]);
    }

    const visited = new Set<ConceptId>();
    const result: Concept[] = [];

    const walk = (id: ConceptId, currentDepth: number) => {
      if (currentDepth > depth) return;
      if (visited.has(id)) return;

      visited.add(id);

      const edges = incoming.get(id) ?? [];

      for (const edge of edges) {
        if (edge.type !== 'prerequisite') continue;

        const prerequisite = byId.get(edge.source);

        if (!prerequisite) continue;

        result.push(prerequisite);

        walk(edge.source, currentDepth + 1);
      }
    };

    walk(conceptId, 1);

    return ok(result);
  }

  // ---------------------------------------------------------------------------
  // DEPENDENTS
  // ---------------------------------------------------------------------------

  /**
   * Returns concepts that depend on the supplied concept.
   */
  async getDependents(
    conceptId: ConceptId,
    depth = Infinity,
  ): Promise<Result<Concept[]>> {
    const graphId = this.findGraphId(conceptId);

    if (!graphId) {
      return ok([]);
    }

    const byId = this.conceptsById.get(graphId);
    const outgoing = this.outgoing.get(graphId);

    if (!byId || !outgoing) {
      return ok([]);
    }

    const visited = new Set<ConceptId>();
    const result: Concept[] = [];

    const walk = (id: ConceptId, currentDepth: number) => {
      if (currentDepth > depth) return;
      if (visited.has(id)) return;

      visited.add(id);

      const edges = outgoing.get(id) ?? [];

      for (const edge of edges) {
        if (edge.type !== 'prerequisite') continue;

        const dependent = byId.get(edge.target);

        if (!dependent) continue;

        result.push(dependent);

        walk(edge.target, currentDepth + 1);
      }
    };

    walk(conceptId, 1);

    return ok(result);
  }

  // ---------------------------------------------------------------------------
  // LEARNING RECOMMENDATIONS
  // ---------------------------------------------------------------------------

  /**
   * Finds concepts worth studying next.
   *
   * Priority:
   * 1. Unmastered prerequisites
   * 2. Low mastery
   * 3. Concepts connected to the user's current concept
   */
  async getRecommendedConcepts(
    conceptId?: ConceptId,
    limit = 10,
  ): Promise<Result<Concept[]>> {
    let candidates: Concept[] = [];

    if (conceptId) {
      const prerequisites = await this.getPrerequisites(conceptId);

      if (prerequisites.success && prerequisites.data) {
        candidates.push(...prerequisites.data);
      }

      const related = await this.getRelated(conceptId);

      if (related.success && related.data) {
        candidates.push(...related.data.related);
      }
    } else {
      candidates = [...this.conceptsById.values()].flatMap((map) =>
        [...map.values()],
      );
    }

    const unique = new Map<ConceptId, Concept>();

    for (const concept of candidates) {
      unique.set(concept.id, concept);
    }

    const ranked = [...unique.values()]
      .map((concept) => ({
        concept,
        score: this.learningScore(concept),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, limit));

    return ok(ranked.map((item) => item.concept));
  }

  private learningScore(concept: Concept): number {
    const mastery =
      typeof concept.mastery === 'number'
        ? Math.max(0, Math.min(1, concept.mastery))
        : 0;

    const difficultyScore =
      concept.difficulty === 'advanced'
        ? 1
        : concept.difficulty === 'intermediate'
          ? 2
          : 3;

    return (1 - mastery) * 100 + difficultyScore;
  }

  // ---------------------------------------------------------------------------
  // GRAPH STATS
  // ---------------------------------------------------------------------------

  getStats(documentId: string): Result<{
    concepts: number;
    relationships: number;
    prerequisites: number;
    related: number;
    averageMastery: number;
  }> {
    const graph = this.graphs.get(documentId);

    if (!graph) {
      return this.fail(`Graph for document ${documentId} not found`);
    }

    const masteryValues = graph.concepts
      .map((c) => c.mastery)
      .filter((value): value is number => typeof value === 'number');

    const averageMastery =
      masteryValues.length > 0
        ? masteryValues.reduce((sum, value) => sum + value, 0) /
          masteryValues.length
        : 0;

    return ok({
      concepts: graph.concepts.length,
      relationships: graph.relationships.length,

      prerequisites: graph.relationships.filter(
        (r) => r.type === 'prerequisite',
      ).length,

      related: graph.relationships.filter(
        (r) => r.type === 'related',
      ).length,

      averageMastery,
    });
  }

  // ---------------------------------------------------------------------------
  // GRAPH MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Replace/update a document graph.
   */
  setGraph(documentId: string, graph: KnowledgeGraph): void {
    const normalized = this.normalizeGraph(graph, documentId);

    this.graphs.set(documentId, normalized);

    this.buildIndexes(documentId, normalized);
  }

  /**
   * Remove graph from memory.
   */
  invalidate(documentId: string): void {
    this.graphs.delete(documentId);
    this.conceptsById.delete(documentId);
    this.outgoing.delete(documentId);
    this.incoming.delete(documentId);

    this.logger.info('Graph invalidated', {
      documentId,
    });
  }

  /**
   * Force backend re-extraction.
   */
  async refresh(documentId: string): Promise<Result<KnowledgeGraph>> {
    this.invalidate(documentId);

    return this.load(documentId);
  }

  /**
   * Clear every cached graph.
   */
  clear(): void {
    this.graphs.clear();
    this.conceptsById.clear();
    this.outgoing.clear();
    this.incoming.clear();
  }

  // ---------------------------------------------------------------------------
  // NORMALIZATION
  // ---------------------------------------------------------------------------

  private normalizeGraph(
    graph: KnowledgeGraph,
    documentId: string,
  ): KnowledgeGraph {
    const concepts = new Map<ConceptId, Concept>();

    for (const concept of graph.concepts ?? []) {
      if (!concept?.id || !concept.label) continue;

      const normalizedId = this.normalizeId(concept.id);

      concepts.set(normalizedId, {
        ...concept,
        id: normalizedId,
        label: concept.label.trim(),
        description: concept.description?.trim(),
        sourceDocumentId: concept.sourceDocumentId ?? documentId,
        mastery:
          typeof concept.mastery === 'number'
            ? Math.max(0, Math.min(1, concept.mastery))
            : 0,
      });
    }

    const relationships = [];

    const seenRelationships = new Set<string>();

    for (const relationship of graph.relationships ?? []) {
      if (!relationship?.source || !relationship?.target) continue;

      const source = this.normalizeId(relationship.source);
      const target = this.normalizeId(relationship.target);

      if (!concepts.has(source) || !concepts.has(target)) {
        continue;
      }

      const key = `${source}|${target}|${relationship.type}`;

      if (seenRelationships.has(key)) {
        continue;
      }

      seenRelationships.add(key);

      relationships.push({
        ...relationship,
        source,
        target,
      });
    }

    return {
      ...graph,
      concepts: [...concepts.values()],
      relationships,
    };
  }

  private normalizeId(id: string): string {
    return id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // ---------------------------------------------------------------------------
  // INDEXING
  // ---------------------------------------------------------------------------

  private buildIndexes(
    documentId: string,
    graph: KnowledgeGraph,
  ): void {
    const byId = new Map<ConceptId, Concept>();

    const outgoing = new Map<
      ConceptId,
      KnowledgeGraph['relationships']
    >();

    const incoming = new Map<
      ConceptId,
      KnowledgeGraph['relationships']
    >();

    for (const concept of graph.concepts) {
      byId.set(concept.id, concept);
      outgoing.set(concept.id, []);
      incoming.set(concept.id, []);
    }

    for (const relationship of graph.relationships) {
      const out = outgoing.get(relationship.source);

      if (out) {
        out.push(relationship);
      }

      const input = incoming.get(relationship.target);

      if (input) {
        input.push(relationship);
      }
    }

    this.conceptsById.set(documentId, byId);
    this.outgoing.set(documentId, outgoing);
    this.incoming.set(documentId, incoming);
  }

  // ---------------------------------------------------------------------------
  // LOOKUPS
  // ---------------------------------------------------------------------------

  private findConcept(conceptId: ConceptId): Concept | undefined {
    for (const concepts of this.conceptsById.values()) {
      const concept = concepts.get(conceptId);

      if (concept) {
        return concept;
      }
    }

    return undefined;
  }

  private findGraphId(conceptId: ConceptId): string | undefined {
    for (const [documentId, concepts] of this.conceptsById) {
      if (concepts.has(conceptId)) {
        return documentId;
      }
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  private publishLoaded(
    documentId: string,
    graph: KnowledgeGraph,
  ): void {
    this.eventBus.publish(
      EventTopics.CONCEPTS_EXTRACTED,
      {
        documentId,
        concepts: graph.concepts,
      },
      'client',
    );
  }

  // ---------------------------------------------------------------------------
  // EMPTY GRAPH
  // ---------------------------------------------------------------------------

  private emptyGraph(documentId: string): KnowledgeGraph {
    return {
      concepts: [],
      relationships: [],
      sourceDocumentId: documentId,
    } as KnowledgeGraph;
  }

  // ---------------------------------------------------------------------------
  // RESULT HELPERS
  // ---------------------------------------------------------------------------

  private fail<T = never>(message: string): Result<T> {
    return {
      success: false,
      error: message,
      retryable: false,
      fallbackAvailable: false,
    };
  }
}
```
