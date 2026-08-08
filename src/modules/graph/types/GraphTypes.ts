import type { Result } from '@/errors/types';

export type ConceptId = string;

export interface Concept {
  id: ConceptId;
  label: string;
  description?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  mastery?: number;
  sourceDocumentId?: string;
  sourcePage?: number;
  sourceRect?: { x: number; y: number; width: number; height: number };
}

export interface ConceptRelationship {
  id: string;
  source: ConceptId;
  target: ConceptId;
  type: 'prerequisite' | 'related' | 'part_of' | 'leads_to';
  strength?: number;
}

export interface KnowledgeGraph {
  concepts: Concept[];
  relationships: ConceptRelationship[];
}

export interface GraphFilter {
  query?: string;
  types?: ConceptRelationship['type'][];
  difficulty?: Concept['difficulty'][];
}

export interface IGraphService {
  load(documentId: string): Promise<Result<KnowledgeGraph>>;
  search(query: string): Promise<Result<Concept[]>>;
  selectConcept(conceptId: ConceptId): Promise<Result<Concept>>;
  getRelated(conceptId: ConceptId): Promise<Result<{ prerequisites: Concept[]; related: Concept[] }>>;
}
