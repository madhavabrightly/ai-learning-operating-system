import type { Result } from '@/errors/types';

export type AssistantContextType = 'selection' | 'formula' | 'concept' | 'figure' | 'table' | 'page' | 'document';

export interface AssistantContext {
  type: AssistantContextType;
  documentId?: string;
  page?: number;
  conceptId?: string;
  formulaId?: string;
  tableId?: string;
  figureId?: string;
  selectionText?: string;
}

export interface AssistantAction {
  id: string;
  label: string;
  intent: 'explain' | 'simplify' | 'summarize' | 'example' | 'prerequisite' | 'related' | 'question' | 'research';
}

export interface AssistantResponse {
  explanation?: string;
  keyIdeas?: string[];
  examples?: string[];
  prerequisites?: string[];
  relatedConcepts?: string[];
  questions?: string[];
  simplified?: string;
}

export interface IAssistantService {
  request(context: AssistantContext, action: AssistantAction['intent']): Promise<Result<AssistantResponse>>;
}
