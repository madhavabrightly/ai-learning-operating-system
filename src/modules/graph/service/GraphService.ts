import { ok } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import type { IEventBus } from '@/events/types';
import { EventTopics } from '@/events/EventTopics';
import type { ILogger } from '@/logging/ILogger';
import type { Concept, ConceptId, IGraphService, KnowledgeGraph } from '../types/GraphTypes';

const DEMO_GRAPH: KnowledgeGraph = {
  concepts: [
    {
      id: 'binary-search',
      label: 'Binary Search',
      description: 'An efficient algorithm for finding an item in a sorted list by repeatedly halving the search space.',
      difficulty: 'beginner',
      mastery: 0.6,
    },
    {
      id: 'time-complexity',
      label: 'Time Complexity',
      description: 'A measure of the amount of time an algorithm takes to run as a function of the length of the input.',
      difficulty: 'intermediate',
      mastery: 0.4,
    },
    {
      id: 'logarithm',
      label: 'Logarithm',
      description: 'The inverse operation to exponentiation; central to understanding O(log n) running times.',
      difficulty: 'beginner',
      mastery: 0.7,
    },
    {
      id: 'sorted-array',
      label: 'Sorted Array',
      description: 'An array whose elements are arranged in a specific order, enabling efficient lookup.',
      difficulty: 'beginner',
      mastery: 0.8,
    },
    {
      id: 'recursion',
      label: 'Recursion',
      description: 'A method where the solution depends on solutions to smaller instances of the same problem.',
      difficulty: 'intermediate',
      mastery: 0.35,
    },
  ],
  relationships: [
    { id: 'r1', source: 'sorted-array', target: 'binary-search', type: 'prerequisite' },
    { id: 'r2', source: 'logarithm', target: 'binary-search', type: 'prerequisite' },
    { id: 'r3', source: 'binary-search', target: 'time-complexity', type: 'leads_to' },
    { id: 'r4', source: 'recursion', target: 'binary-search', type: 'related' },
  ],
};

export class GraphService implements IGraphService {
  private graphs = new Map<string, KnowledgeGraph>();

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  async load(documentId: string): Promise<Result<KnowledgeGraph>> {
    let graph = this.graphs.get(documentId);
    if (!graph) {
      graph = {
        ...DEMO_GRAPH,
        concepts: DEMO_GRAPH.concepts.map((c) => ({ ...c, sourceDocumentId: documentId })),
      };
      this.graphs.set(documentId, graph);
    }
    this.eventBus.publish(EventTopics.CONCEPTS_EXTRACTED, { documentId, concepts: graph.concepts }, 'client');
    this.logger.info('Graph loaded', { documentId, concepts: graph.concepts.length });
    return ok(graph);
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
    const graph = [...this.graphs.values()].find((g) => g.concepts.some((c) => c.id === conceptId)) ?? DEMO_GRAPH;
    const prereqIds = graph.relationships.filter((r) => r.target === conceptId && r.type === 'prerequisite').map((r) => r.source);
    const relatedIds = graph.relationships.filter((r) => (r.source === conceptId || r.target === conceptId) && r.type !== 'prerequisite').map((r) => (r.source === conceptId ? r.target : r.source));
    const byId = new Map(graph.concepts.map((c) => [c.id, c]));
    return ok({
      prerequisites: prereqIds.map((id) => byId.get(id)).filter((c): c is Concept => Boolean(c)),
      related: relatedIds.map((id) => byId.get(id)).filter((c): c is Concept => Boolean(c)),
    });
  }
}
