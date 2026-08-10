import type { Result } from '@/errors/types';

export type ConceptId = string;

export type ConceptDifficulty =
  | 'beginner'
  | 'intermediate'
  | 'advanced';

export type RelationshipType =
  | 'prerequisite'
  | 'related'
  | 'part_of'
  | 'leads_to';

export interface SourceReference {
  documentId: string;

  page?: number;

  chunkId?: string;

  /**
   * Exact text supporting this concept/relationship.
   */
  text?: string;

  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface Concept {
  id: ConceptId;

  /**
   * Canonical concept name.
   */
  label: string;

  /**
   * Short explanation suitable for UI/chat.
   */
  description?: string;

  /**
   * Search aliases.
   */
  aliases?: string[];

  difficulty?: ConceptDifficulty;

  /**
   * User learning state.
   * 0 = unknown / weak
   * 1 = mastered
   */
  mastery?: number;

  /**
   * Confidence that extraction is correct.
   * 0..1
   */
  confidence?: number;

  /**
   * Source document.
   */
  sourceDocumentId?: string;

  /**
   * Primary source location.
   */
  sourcePage?: number;

  sourceChunkId?: string;

  sourceRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  /**
   * Evidence extracted from the document.
   */
  evidence?: string;

  /**
   * All known source references.
   *
   * Useful when a concept appears on multiple pages.
   */
  sources?: SourceReference[];

  /**
   * Useful for filtering and recommendations.
   */
  tags?: string[];

  /**
   * Optional semantic metadata.
   */
  metadata?: Record<string, unknown>;
}

export interface ConceptRelationship {
  id: string;

  source: ConceptId;

  target: ConceptId;

  type: RelationshipType;

  /**
   * Semantic strength.
   */
  strength?: number;

  /**
   * Extraction confidence.
   */
  confidence?: number;

  /**
   * Why this relationship exists.
   */
  evidence?: string;

  sourcePage?: number;

  sourceChunkId?: string;

  sources?: SourceReference[];

  metadata?: Record<string, unknown>;
}

export interface KnowledgeGraph {
  documentId?: string;

  concepts: Concept[];

  relationships: ConceptRelationship[];

  metadata?: {
    version?: string;

    extractor?: string;

    generatedAt?: string;

    processingTimeMs?: number;

    conceptCount?: number;

    relationshipCount?: number;

    qualityScore?: number;

    [key: string]: unknown;
  };
}

export interface GraphFilter {
  query?: string;

  types?: RelationshipType[];

  difficulty?: ConceptDifficulty[];

  tags?: string[];

  minMastery?: number;

  maxMastery?: number;

  minConfidence?: number;
}

export interface GraphSearchOptions {
  documentId?: string;

  limit?: number;

  filter?: GraphFilter;
}

export interface GraphTraversalOptions {
  documentId?: string;

  /**
   * Maximum traversal depth.
   */
  depth?: number;

  relationshipTypes?: RelationshipType[];

  /**
   * Ignore relationships below this confidence.
   */
  minConfidence?: number;
}

export interface LearningPathNode {
  concept: Concept;

  depth: number;

  mastery: number;

  prerequisitesCompleted: boolean;
}

export interface GraphRecommendationOptions {
  documentId?: string;

  conceptId?: ConceptId;

  limit?: number;

  /**
   * Prefer concepts with low mastery.
   */
  prioritizeWeakConcepts?: boolean;

  /**
   * Prefer prerequisites.
   */
  prioritizePrerequisites?: boolean;
}

export interface GraphStats {
  documentId: string;

  concepts: number;

  relationships: number;

  prerequisites: number;

  related: number;

  partOf: number;

  leadsTo: number;

  orphanConcepts: number;

  averageMastery: number;

  averageConfidence: number;

  qualityScore: number;
}

export interface IGraphService {
  load(
    documentId: string,
  ): Promise<Result<KnowledgeGraph>>;

  search(
    query: string,
    options?: GraphSearchOptions,
  ): Promise<Result<Concept[]>>;

  selectConcept(
    conceptId: ConceptId,
    documentId?: string,
  ): Promise<Result<Concept>>;

  getRelated(
    conceptId: ConceptId,
    documentId?: string,
  ): Promise<
    Result<{
      prerequisites: Concept[];
      related: Concept[];
    }>
  >;

  getPrerequisites(
    conceptId: ConceptId,
    options?: GraphTraversalOptions,
  ): Promise<Result<Concept[]>>;

  getDependents(
    conceptId: ConceptId,
    options?: GraphTraversalOptions,
  ): Promise<Result<Concept[]>>;

  getLearningPath(
    conceptId: ConceptId,
    options?: GraphTraversalOptions,
  ): Promise<Result<LearningPathNode[]>>;

  getRecommendedConcepts(
    options?: GraphRecommendationOptions,
  ): Promise<Result<Concept[]>>;

  getStats(
    documentId: string,
  ): Result<GraphStats>;

  setGraph(
    documentId: string,
    graph: KnowledgeGraph,
  ): void;

  invalidate(
    documentId: string,
  ): void;

  refresh(
    documentId: string,
  ): Promise<Result<KnowledgeGraph>>;

  clear(): void;
}