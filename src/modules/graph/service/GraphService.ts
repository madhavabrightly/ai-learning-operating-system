import { ok } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import type { IEventBus } from '@/events/types';
import { EventTopics } from '@/events/EventTopics';
import type { ILogger } from '@/logging/ILogger';
import type { DocumentService } from '@/modules/document/service/DocumentService';

import type {
  GraphExtractor,
  GraphExtractionOptions,
} from './BackendGraphExtractor';

import type {
  Concept,
  ConceptId,
  ConceptRelationship,
  GraphRecommendationOptions,
  GraphSearchOptions,
  GraphStats,
  GraphTraversalOptions,
  IGraphService,
  KnowledgeGraph,
  LearningPathNode,
  RelationshipType,
} from '../types/GraphTypes';

export class GraphService implements IGraphService {
  /**
   * Complete document graphs.
   */
  private readonly graphs =
    new Map<string, KnowledgeGraph>();

  /**
   * documentId -> conceptId -> Concept
   */
  private readonly conceptIndex =
    new Map<
      string,
      Map<ConceptId, Concept>
    >();

  /**
   * documentId -> conceptId -> outgoing edges
   */
  private readonly outgoingIndex =
    new Map<
      string,
      Map<ConceptId, ConceptRelationship[]>
    >();

  /**
   * documentId -> conceptId -> incoming edges
   */
  private readonly incomingIndex =
    new Map<
      string,
      Map<ConceptId, ConceptRelationship[]>
    >();

  /**
   * Prevent duplicate simultaneous extraction.
   */
  private readonly loading =
    new Map<
      string,
      Promise<Result<KnowledgeGraph>>
    >();

  private readonly extractor?: GraphExtractor;

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    _documentService?: DocumentService,
    options?: {
      extractor?: GraphExtractor;
    },
  ) {
    this.extractor =
      options?.extractor;
  }

  // ===========================================================================
  // LOAD
  // ===========================================================================

  async load(
    documentId: string,
  ): Promise<Result<KnowledgeGraph>> {
    const id =
      documentId.trim();

    if (!id) {
      return this.failure(
        'Document ID is required',
      );
    }

    const cached =
      this.graphs.get(id);

    if (cached) {
      this.publishGraph(
        id,
        cached,
      );

      return ok(cached);
    }

    const existing =
      this.loading.get(id);

    if (existing) {
      return existing;
    }

    const request =
      this.extractGraph(id);

    this.loading.set(
      id,
      request,
    );

    try {
      return await request;
    } finally {
      this.loading.delete(id);
    }
  }

  private async extractGraph(
    documentId: string,
  ): Promise<Result<KnowledgeGraph>> {
    if (!this.extractor) {
      const empty =
        this.createEmptyGraph(
          documentId,
        );

      this.setGraph(
        documentId,
        empty,
      );

      return ok(empty);
    }

    try {
      const result =
        await this.extractor.extract(
          documentId,
        );

      if (
        !result.success ||
        !result.data
      ) {
        this.logger.info(
          'Graph extraction failed',
          {
            documentId,
            error: result.error,
          },
        );

        return result;
      }

      const graph =
        this.normalizeGraph(
          result.data,
          documentId,
        );

      this.setGraph(
        documentId,
        graph,
      );

      this.publishGraph(
        documentId,
        graph,
      );

      this.logger.info(
        'Study graph loaded',
        {
          documentId,
          concepts:
            graph.concepts.length,
          relationships:
            graph.relationships.length,
        },
      );

      return ok(graph);
    } catch (error) {
      this.logger.info(
        'Graph extraction exception',
        {
          documentId,
          error,
        },
      );

      return this.failure(
        `Graph extraction failed for ${documentId}`,
        true,
      );
    }
  }

  // ===========================================================================
  // SEARCH
  // ===========================================================================

  async search(
    query: string,
    options: GraphSearchOptions = {},
  ): Promise<Result<Concept[]>> {
    const q =
      query.trim().toLowerCase();

    if (!q) {
      return ok([]);
    }

    const documentIds =
      options.documentId
        ? [options.documentId]
        : [...this.graphs.keys()];

    const results: {
      concept: Concept;
      score: number;
    }[] = [];

    for (
      const documentId of documentIds
    ) {
      const concepts =
        this.conceptIndex.get(
          documentId,
        );

      if (!concepts) continue;

      for (
        const concept of
        concepts.values()
      ) {
        if (
          !this.matchesFilter(
            concept,
            options,
          )
        ) {
          continue;
        }

        const score =
          this.calculateSearchScore(
            concept,
            q,
          );

        if (score > 0) {
          results.push({
            concept,
            score,
          });
        }
      }
    }

    results.sort(
      (a, b) =>
        b.score - a.score,
    );

    const limit =
      options.limit ?? 30;

    return ok(
      results
        .slice(0, limit)
        .map(
          (item) =>
            item.concept,
        ),
    );
  }

  private calculateSearchScore(
    concept: Concept,
    query: string,
  ): number {
    const label =
      concept.label
        .toLowerCase();

    const description =
      concept.description
        ?.toLowerCase() ?? '';

    const evidence =
      concept.evidence
        ?.toLowerCase() ?? '';

    const aliases =
      concept.aliases
        ?.map((x) =>
          x.toLowerCase(),
        ) ?? [];

    let score = 0;

    // Exact concept match.
    if (label === query) {
      score += 1000;
    }

    // Strong prefix match.
    if (
      label.startsWith(query)
    ) {
      score += 500;
    }

    // Normal label match.
    if (
      label.includes(query)
    ) {
      score += 300;
    }

    // Alias match.
    for (
      const alias of aliases
    ) {
      if (alias === query) {
        score += 450;
      } else if (
        alias.includes(query)
      ) {
        score += 180;
      }
    }

    // Description.
    if (
      description.includes(query)
    ) {
      score += 100;
    }

    // Grounding evidence.
    if (
      evidence.includes(query)
    ) {
      score += 50;
    }

    // Extraction quality.
    score +=
      this.clamp01(
        concept.confidence ?? 0,
      ) * 25;

    return score;
  }

  private matchesFilter(
    concept: Concept,
    options: GraphSearchOptions,
  ): boolean {
    const filter =
      options.filter;

    if (!filter) {
      return true;
    }

    if (
      filter.difficulty?.length &&
      (
        !concept.difficulty ||
        !filter.difficulty.includes(
          concept.difficulty,
        )
      )
    ) {
      return false;
    }

    if (
      filter.types?.length
    ) {
      const graph =
        concept.sourceDocumentId
          ? this.graphs.get(
              concept.sourceDocumentId,
            )
          : undefined;

      if (graph) {
        const hasType =
          graph.relationships.some(
            (r) =>
              (
                r.source ===
                  concept.id ||
                r.target ===
                  concept.id
              ) &&
              filter.types!.includes(
                r.type,
              ),
          );

        if (!hasType) {
          return false;
        }
      }
    }

    if (
      filter.tags?.length
    ) {
      const tags =
        concept.tags ?? [];

      if (
        !filter.tags.some(
          (tag) =>
            tags.includes(tag),
        )
      ) {
        return false;
      }
    }

    const mastery =
      concept.mastery ?? 0;

    if (
      typeof filter.minMastery ===
        'number' &&
      mastery <
        filter.minMastery
    ) {
      return false;
    }

    if (
      typeof filter.maxMastery ===
        'number' &&
      mastery >
        filter.maxMastery
    ) {
      return false;
    }

    if (
      typeof filter.minConfidence ===
        'number' &&
      (concept.confidence ?? 0) <
        filter.minConfidence
    ) {
      return false;
    }

    return true;
  }

  // ===========================================================================
  // SELECT
  // ===========================================================================

  async selectConcept(
    conceptId: ConceptId,
    documentId?: string,
  ): Promise<Result<Concept>> {
    const concept =
      this.findConcept(
        conceptId,
        documentId,
      );

    if (!concept) {
      return this.failure(
        `Concept ${conceptId} not found`,
      );
    }

    this.eventBus.publish(
      EventTopics.CONCEPT_SELECTED,
      {
        conceptId,
        concept,
        documentId:
          concept.sourceDocumentId,
      },
      'client',
    );

    return ok(concept);
  }

  // ===========================================================================
  // DIRECT RELATED CONCEPTS
  // ===========================================================================

  async getRelated(
    conceptId: ConceptId,
    documentId?: string,
  ): Promise<
    Result<{
      prerequisites: Concept[];
      related: Concept[];
    }>
  > {
    const graphId =
      this.findGraphId(
        conceptId,
        documentId,
      );

    if (!graphId) {
      return ok({
        prerequisites: [],
        related: [],
      });
    }

    const concepts =
      this.conceptIndex.get(
        graphId,
      );

    if (!concepts) {
      return ok({
        prerequisites: [],
        related: [],
      });
    }

    const incoming =
      this.incomingIndex.get(
        graphId,
      );

    const outgoing =
      this.outgoingIndex.get(
        graphId,
      );

    const prerequisiteIds =
      new Set<ConceptId>();

    const relatedIds =
      new Set<ConceptId>();

    // Incoming prerequisite:
    //
    // Sorted Array -> Binary Search
    //
    // Therefore Sorted Array is prerequisite.
    for (
      const edge of
      incoming?.get(
        conceptId,
      ) ?? []
    ) {
      if (
        edge.type ===
        'prerequisite'
      ) {
        prerequisiteIds.add(
          edge.source,
        );
      }

      if (
        edge.type === 'related'
      ) {
        relatedIds.add(
          edge.source,
        );
      }
    }

    // Related edges are undirected semantically.
    for (
      const edge of
      outgoing?.get(
        conceptId,
      ) ?? []
    ) {
      if (
        edge.type === 'related'
      ) {
        relatedIds.add(
          edge.target,
        );
      }
    }

    return ok({
      prerequisites:
        this.resolveConcepts(
          concepts,
          prerequisiteIds,
        ),

      related:
        this.resolveConcepts(
          concepts,
          relatedIds,
        ),
    });
  }

  // ===========================================================================
  // PREREQUISITES
  // ===========================================================================

  async getPrerequisites(
    conceptId: ConceptId,
    options: GraphTraversalOptions = {},
  ): Promise<Result<Concept[]>> {
    const graphId =
      this.findGraphId(
        conceptId,
        options.documentId,
      );

    if (!graphId) {
      return ok([]);
    }

    const concepts =
      this.conceptIndex.get(
        graphId,
      );

    const incoming =
      this.incomingIndex.get(
        graphId,
      );

    if (
      !concepts ||
      !incoming
    ) {
      return ok([]);
    }

    const depth =
      options.depth ?? Infinity;

    const minimumConfidence =
      options.minConfidence ?? 0;

    const visited =
      new Set<ConceptId>();

    const result: Concept[] =
      [];

    const walk = (
      current: ConceptId,
      currentDepth: number,
    ): void => {
      if (
        currentDepth > depth ||
        visited.has(current)
      ) {
        return;
      }

      visited.add(current);

      for (
        const edge of
        incoming.get(
          current,
        ) ?? []
      ) {
        if (
          edge.type !==
          'prerequisite'
        ) {
          continue;
        }

        if (
          (edge.confidence ?? 1) <
          minimumConfidence
        ) {
          continue;
        }

        const concept =
          concepts.get(
            edge.source,
          );

        if (!concept) {
          continue;
        }

        if (
          !visited.has(
            concept.id,
          )
        ) {
          result.push(
            concept,
          );
        }

        walk(
          concept.id,
          currentDepth + 1,
        );
      }
    };

    walk(
      conceptId,
      1,
    );

    return ok(
      this.sortForLearning(
        result,
      ),
    );
  }

  // ===========================================================================
  // DEPENDENTS
  // ===========================================================================

  async getDependents(
    conceptId: ConceptId,
    options: GraphTraversalOptions = {},
  ): Promise<Result<Concept[]>> {
    const graphId =
      this.findGraphId(
        conceptId,
        options.documentId,
      );

    if (!graphId) {
      return ok([]);
    }

    const concepts =
      this.conceptIndex.get(
        graphId,
      );

    const outgoing =
      this.outgoingIndex.get(
        graphId,
      );

    if (
      !concepts ||
      !outgoing
    ) {
      return ok([]);
    }

    const depth =
      options.depth ?? Infinity;

    const visited =
      new Set<ConceptId>();

    const result: Concept[] =
      [];

    const walk = (
      current: ConceptId,
      currentDepth: number,
    ): void => {
      if (
        currentDepth > depth ||
        visited.has(current)
      ) {
        return;
      }

      visited.add(current);

      for (
        const edge of
        outgoing.get(
          current,
        ) ?? []
      ) {
        if (
          edge.type !==
          'prerequisite'
        ) {
          continue;
        }

        const concept =
          concepts.get(
            edge.target,
          );

        if (!concept) {
          continue;
        }

        if (
          !visited.has(
            concept.id,
          )
        ) {
          result.push(
            concept,
          );
        }

        walk(
          concept.id,
          currentDepth + 1,
        );
      }
    };

    walk(
      conceptId,
      1,
    );

    return ok(result);
  }

  // ===========================================================================
  // LEARNING PATH
  // ===========================================================================

  async getLearningPath(
    conceptId: ConceptId,
    options: GraphTraversalOptions = {},
  ): Promise<
    Result<LearningPathNode[]>
  > {
    const graphId =
      this.findGraphId(
        conceptId,
        options.documentId,
      );

    if (!graphId) {
      return ok([]);
    }

    const concepts =
      this.conceptIndex.get(
        graphId,
      );

    const incoming =
      this.incomingIndex.get(
        graphId,
      );

    if (
      !concepts ||
      !incoming
    ) {
      return ok([]);
    }

    const depth =
      options.depth ?? Infinity;

    const visited =
      new Set<ConceptId>();

    const nodes:
      LearningPathNode[] =
      [];

    const walk = (
      id: ConceptId,
      currentDepth: number,
    ): void => {
      if (
        currentDepth > depth ||
        visited.has(id)
      ) {
        return;
      }

      visited.add(id);

      const concept =
        concepts.get(id);

      if (!concept) {
        return;
      }

      const edges =
        incoming.get(id) ?? [];

      const prerequisites =
        edges.filter(
          (edge) =>
            edge.type ===
            'prerequisite',
        );

      const prerequisitesCompleted =
        prerequisites.every(
          (edge) =>
            (
              concepts.get(
                edge.source,
              )?.mastery ?? 0
            ) >= 0.8,
        );

      nodes.push({
        concept,

        depth:
          currentDepth,

        mastery:
          concept.mastery ?? 0,

        prerequisitesCompleted,
      });

      for (
        const edge of
        prerequisites
      ) {
        walk(
          edge.source,
          currentDepth + 1,
        );
      }
    };

    walk(
      conceptId,
      0,
    );

    return ok(
      nodes.sort(
        (a, b) => {
          if (
            a.depth !==
            b.depth
          ) {
            return (
              b.depth -
              a.depth
            );
          }

          return (
            a.mastery -
            b.mastery
          );
        },
      ),
    );
  }

  // ===========================================================================
  // RECOMMENDATIONS
  // ===========================================================================

  async getRecommendedConcepts(
    options: GraphRecommendationOptions = {},
  ): Promise<Result<Concept[]>> {
    const limit =
      options.limit ?? 10;

    let candidates: Concept[] =
      [];

    if (
      options.conceptId
    ) {
      const prerequisites =
        await this.getPrerequisites(
          options.conceptId,
          {
            documentId:
              options.documentId,
          },
        );

      candidates.push(
        ...(prerequisites.data ??
          []),
      );

      const related =
        await this.getRelated(
          options.conceptId,
          options.documentId,
        );

      candidates.push(
        ...(related.data
          ?.related ?? []),
      );
    } else {
      const documentIds =
        options.documentId
          ? [
              options.documentId,
            ]
          : [
              ...this.graphs.keys(),
            ];

      for (
        const documentId of
        documentIds
      ) {
        const concepts =
          this.conceptIndex.get(
            documentId,
          );

        if (concepts) {
          candidates.push(
            ...concepts.values(),
          );
        }
      }
    }

    /**
     * Remove duplicates.
     */
    const unique =
      new Map<
        string,
        Concept
      >();

    for (
      const concept of
      candidates
    ) {
      unique.set(
        `${concept.sourceDocumentId}:${concept.id}`,
        concept,
      );
    }

    const ranked =
      [...unique.values()]
        .map((concept) => ({
          concept,

          score:
            this.calculateRecommendationScore(
              concept,
              options,
            ),
        }))
        .sort(
          (a, b) =>
            b.score -
            a.score,
        )
        .slice(0, limit);

    return ok(
      ranked.map(
        (item) =>
          item.concept,
      ),
    );
  }

  private calculateRecommendationScore(
    concept: Concept,
    options: GraphRecommendationOptions,
  ): number {
    const mastery =
      this.clamp01(
        concept.mastery ?? 0,
      );

    const confidence =
      this.clamp01(
        concept.confidence ?? 1,
      );

    let score = 0;

    /**
     * Weak concepts should surface.
     */
    if (
      options.prioritizeWeakConcepts !==
      false
    ) {
      score +=
        (1 - mastery) *
        100;
    }

    /**
     * Trust high-confidence concepts.
     */
    score +=
      confidence * 20;

    /**
     * Prerequisite concepts are
     * more valuable for learning.
     */
    if (
      options.prioritizePrerequisites !==
      false
    ) {
      score +=
        this.isPrerequisite(
          concept,
        )
          ? 40
          : 0;
    }

    /**
     * Prefer concepts that have
     * useful source grounding.
     */
    if (
      concept.sources?.length
    ) {
      score += 10;
    }

    return score;
  }

  private isPrerequisite(
    concept: Concept,
  ): boolean {
    const documentId =
      concept.sourceDocumentId;

    if (!documentId) {
      return false;
    }

    const graph =
      this.graphs.get(
        documentId,
      );

    if (!graph) {
      return false;
    }

    return graph.relationships.some(
      (edge) =>
        edge.type ===
          'prerequisite' &&
        edge.source ===
          concept.id,
    );
  }

  // ===========================================================================
  // STATS / QUALITY
  // ===========================================================================

  getStats(
    documentId: string,
  ): Result<GraphStats> {
    const graph =
      this.graphs.get(
        documentId,
      );

    if (!graph) {
      return this.failure(
        `Graph ${documentId} is not loaded`,
      );
    }

    const relationships =
      graph.relationships;

    const concepts =
      graph.concepts;

    const connected =
      new Set<ConceptId>();

    for (
      const edge of
      relationships
    ) {
      connected.add(
        edge.source,
      );

      connected.add(
        edge.target,
      );
    }

    const mastery =
      concepts
        .map(
          (c) => c.mastery,
        )
        .filter(
          (
            value,
          ): value is number =>
            typeof value ===
            'number',
        );

    const confidence =
      concepts
        .map(
          (c) =>
            c.confidence,
        )
        .filter(
          (
            value,
          ): value is number =>
            typeof value ===
            'number',
        );

    return ok({
      documentId,

      concepts:
        concepts.length,

      relationships:
        relationships.length,

      prerequisites:
        this.countType(
          relationships,
          'prerequisite',
        ),

      related:
        this.countType(
          relationships,
          'related',
        ),

      partOf:
        this.countType(
          relationships,
          'part_of',
        ),

      leadsTo:
        this.countType(
          relationships,
          'leads_to',
        ),

      orphanConcepts:
        concepts.filter(
          (c) =>
            !connected.has(
              c.id,
            ),
        ).length,

      averageMastery:
        this.average(
          mastery,
        ),

      averageConfidence:
        this.average(
          confidence,
        ),

      qualityScore:
        this.calculateGraphQuality(
          graph,
        ),
    });
  }

  private calculateGraphQuality(
    graph: KnowledgeGraph,
  ): number {
    if (
      graph.concepts.length === 0
    ) {
      return 0;
    }

    const concepts =
      graph.concepts;

    const grounded =
      concepts.filter(
        (c) =>
          Boolean(
            c.sourcePage ||
            c.sourceChunkId ||
            c.evidence ||
            c.sources?.length,
          ),
      ).length;

    const confident =
      concepts.filter(
        (c) =>
          (c.confidence ?? 0) >=
          0.7,
      ).length;

    const connected =
      new Set<ConceptId>();

    for (
      const edge of
      graph.relationships
    ) {
      connected.add(
        edge.source,
      );

      connected.add(
        edge.target,
      );
    }

    const connectedRatio =
      connected.size /
      concepts.length;

    const groundingRatio =
      grounded /
      concepts.length;

    const confidenceRatio =
      confident /
      concepts.length;

    return this.clamp01(
      groundingRatio *
        0.4 +
        confidenceRatio *
          0.35 +
        Math.min(
          connectedRatio,
          1,
        ) *
          0.25,
    );
  }

  // ===========================================================================
  // GRAPH MUTATION / CACHE
  // ===========================================================================

  setGraph(
    documentId: string,
    graph: KnowledgeGraph,
  ): void {
    const normalized =
      this.normalizeGraph(
        graph,
        documentId,
      );

    this.graphs.set(
      documentId,
      normalized,
    );

    this.buildIndexes(
      documentId,
      normalized,
    );
  }

  invalidate(
    documentId: string,
  ): void {
    this.graphs.delete(
      documentId,
    );

    this.conceptIndex.delete(
      documentId,
    );

    this.outgoingIndex.delete(
      documentId,
    );

    this.incomingIndex.delete(
      documentId,
    );
  }

  async refresh(
    documentId: string,
  ): Promise<Result<KnowledgeGraph>> {
    this.invalidate(
      documentId,
    );

    return this.load(
      documentId,
    );
  }

  clear(): void {
    this.graphs.clear();

    this.conceptIndex.clear();

    this.outgoingIndex.clear();

    this.incomingIndex.clear();

    this.loading.clear();
  }

  // ===========================================================================
  // NORMALIZATION
  // ===========================================================================

  private normalizeGraph(
    graph: KnowledgeGraph,
    documentId: string,
  ): KnowledgeGraph {
    const conceptMap =
      new Map<
        ConceptId,
        Concept
      >();

    for (
      const concept of
      graph.concepts ?? []
    ) {
      if (
        !concept?.id ||
        !concept?.label
      ) {
        continue;
      }

      const id =
        this.normalizeId(
          concept.id,
        );

      const normalized: Concept = {
        ...concept,

        id,

        label:
          concept.label.trim(),

        description:
          concept.description?.trim(),

        sourceDocumentId:
          concept.sourceDocumentId ??
          documentId,

        mastery:
          this.clamp01(
            concept.mastery ?? 0,
          ),

        confidence:
          typeof concept.confidence ===
          'number'
            ? this.clamp01(
                concept.confidence,
              )
            : undefined,

        aliases:
          concept.aliases
            ?.map(
              (x) => x.trim(),
            )
            .filter(Boolean),

        tags:
          concept.tags
            ?.map(
              (x) =>
                x
                  .trim()
                  .toLowerCase(),
            )
            .filter(Boolean),
      };

      const existing =
        conceptMap.get(id);

      /**
       * If extraction produced the
       * same concept multiple times,
       * merge evidence/source data
       * instead of creating duplicates.
       */
      if (existing) {
        conceptMap.set(
          id,
          this.mergeConcepts(
            existing,
            normalized,
          ),
        );
      } else {
        conceptMap.set(
          id,
          normalized,
        );
      }
    }

    const relationshipMap =
      new Map<
        string,
        ConceptRelationship
      >();

    for (
      const relationship of
      graph.relationships ?? []
    ) {
      if (
        !relationship?.source ||
        !relationship?.target
      ) {
        continue;
      }

      const source =
        this.normalizeId(
          relationship.source,
        );

      const target =
        this.normalizeId(
          relationship.target,
        );

      /**
       * Never keep dangling
       * relationships.
       */
      if (
        !conceptMap.has(source) ||
        !conceptMap.has(target)
      ) {
        continue;
      }

      /**
       * Avoid self loops unless
       * explicitly needed later.
       */
      if (
        source === target
      ) {
        continue;
      }

      const key =
        `${source}:${target}:${relationship.type}`;

      const normalized: ConceptRelationship =
        {
          ...relationship,

          id:
            relationship.id ||
            key,

          source,

          target,

          strength:
            typeof relationship.strength ===
            'number'
              ? this.clamp01(
                  relationship.strength,
                )
              : undefined,

          confidence:
            typeof relationship.confidence ===
            'number'
              ? this.clamp01(
                  relationship.confidence,
                )
              : undefined,
        };

      const existing =
        relationshipMap.get(
          key,
        );

      if (existing) {
        relationshipMap.set(
          key,
          this.mergeRelationships(
            existing,
            normalized,
          ),
        );
      } else {
        relationshipMap.set(
          key,
          normalized,
        );
      }
    }

    const concepts =
      [...conceptMap.values()];

    const relationships =
      [...relationshipMap.values()];

    return {
      documentId,

      concepts,

      relationships,

      metadata: {
        ...(graph.metadata ?? {}),

        generatedAt:
          graph.metadata
            ?.generatedAt ??
          new Date().toISOString(),

        conceptCount:
          concepts.length,

        relationshipCount:
          relationships.length,

        qualityScore:
          this.calculateGraphQuality(
            {
              documentId,
              concepts,
              relationships,
            },
          ),
      },
    };
  }

  private mergeConcepts(
    a: Concept,
    b: Concept,
  ): Concept {
    const aliases =
      new Set([
        ...(a.aliases ?? []),
        ...(b.aliases ?? []),
      ]);

    const tags =
      new Set([
        ...(a.tags ?? []),
        ...(b.tags ?? []),
      ]);

    const sources = [
      ...(a.sources ?? []),
      ...(b.sources ?? []),
    ];

    return {
      ...a,

      description:
        a.description ||
        b.description,

      evidence:
        a.evidence ||
        b.evidence,

      confidence:
        Math.max(
          a.confidence ?? 0,
          b.confidence ?? 0,
        ),

      mastery:
        Math.max(
          a.mastery ?? 0,
          b.mastery ?? 0,
        ),

      aliases:
        [...aliases],

      tags:
        [...tags],

      sources:
        sources.length
          ? sources
          : undefined,
    };
  }

  private mergeRelationships(
    a: ConceptRelationship,
    b: ConceptRelationship,
  ): ConceptRelationship {
    return {
      ...a,

      strength:
        Math.max(
          a.strength ?? 0,
          b.strength ?? 0,
        ),

      confidence:
        Math.max(
          a.confidence ?? 0,
          b.confidence ?? 0,
        ),

      evidence:
        a.evidence ||
        b.evidence,

      sources: [
        ...(a.sources ?? []),
        ...(b.sources ?? []),
      ],
    };
  }

  // ===========================================================================
  // INDEXING
  // ===========================================================================

  private buildIndexes(
    documentId: string,
    graph: KnowledgeGraph,
  ): void {
    const concepts =
      new Map<
        ConceptId,
        Concept
      >();

    const outgoing =
      new Map<
        ConceptId,
        ConceptRelationship[]
      >();

    const incoming =
      new Map<
        ConceptId,
        ConceptRelationship[]
      >();

    for (
      const concept of
      graph.concepts
    ) {
      concepts.set(
        concept.id,
        concept,
      );

      outgoing.set(
        concept.id,
        [],
      );

      incoming.set(
        concept.id,
        [],
      );
    }

    for (
      const edge of
      graph.relationships
    ) {
      outgoing
        .get(edge.source)
        ?.push(edge);

      incoming
        .get(edge.target)
        ?.push(edge);
    }

    this.conceptIndex.set(
      documentId,
      concepts,
    );

    this.outgoingIndex.set(
      documentId,
      outgoing,
    );

    this.incomingIndex.set(
      documentId,
      incoming,
    );
  }

  // ===========================================================================
  // LOOKUPS
  // ===========================================================================

  private findConcept(
    conceptId: ConceptId,
    documentId?: string,
  ): Concept | undefined {
    if (documentId) {
      return this.conceptIndex
        .get(documentId)
        ?.get(conceptId);
    }

    for (
      const concepts of
      this.conceptIndex.values()
    ) {
      const concept =
        concepts.get(
          conceptId,
        );

      if (concept) {
        return concept;
      }
    }

    return undefined;
  }

  private findGraphId(
    conceptId: ConceptId,
    documentId?: string,
  ): string | undefined {
    if (
      documentId &&
      this.conceptIndex
        .get(documentId)
        ?.has(conceptId)
    ) {
      return documentId;
    }

    for (
      const [
        id,
        concepts,
      ] of this.conceptIndex
    ) {
      if (
        concepts.has(
          conceptId,
        )
      ) {
        return id;
      }
    }

    return undefined;
  }

  private resolveConcepts(
    index: Map<
      ConceptId,
      Concept
    >,
    ids: Set<ConceptId>,
  ): Concept[] {
    const result: Concept[] =
      [];

    for (
      const id of ids
    ) {
      const concept =
        index.get(id);

      if (concept) {
        result.push(
          concept,
        );
      }
    }

    return result;
  }

  // ===========================================================================
  // LEARNING ORDER
  // ===========================================================================

  private sortForLearning(
    concepts: Concept[],
  ): Concept[] {
    return [...concepts].sort(
      (a, b) => {
        const masteryA =
          a.mastery ?? 0;

        const masteryB =
          b.mastery ?? 0;

        const confidenceA =
          a.confidence ?? 1;

        const confidenceB =
          b.confidence ?? 1;

        return (
          (1 - masteryB) *
            100 +
          confidenceB *
            10 -
          (
            (1 - masteryA) *
              100 +
            confidenceA *
              10
          )
        );
      },
    );
  }

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  private publishGraph(
    documentId: string,
    graph: KnowledgeGraph,
  ): void {
    this.eventBus.publish(
      EventTopics.CONCEPTS_EXTRACTED,
      {
        documentId,

        concepts:
          graph.concepts,

        relationships:
          graph.relationships,

        metadata:
          graph.metadata,
      },
      'client',
    );
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private countType(
    relationships: ConceptRelationship[],
    type: RelationshipType,
  ): number {
    return relationships.filter(
      (r) =>
        r.type === type,
    ).length;
  }

  private average(
    values: number[],
  ): number {
    if (!values.length) {
      return 0;
    }

    return (
      values.reduce(
        (sum, value) =>
          sum + value,
        0,
      ) / values.length
    );
  }

  private normalizeId(
    value: string,
  ): string {
    return value
      .trim()
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        '-',
      )
      .replace(
        /^-+|-+$/g,
        '');
  }

  private clamp01(
    value: number,
  ): number {
    return Math.max(
      0,
      Math.min(
        1,
        Number.isFinite(value)
          ? value
          : 0,
      ),
    );
  }

  private createEmptyGraph(
    documentId: string,
  ): KnowledgeGraph {
    return {
      documentId,

      concepts: [],

      relationships: [],

      metadata: {
        generatedAt:
          new Date().toISOString(),

        conceptCount: 0,

        relationshipCount: 0,

        qualityScore: 0,
      },
    };
  }

  private failure<T = never>(
    message: string,
    retryable = false,
  ): Result<T> {
    return {
      success: false,

      error: message,

      retryable,

      fallbackAvailable: false,
    };
  }
}