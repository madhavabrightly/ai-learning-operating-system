import type { AiActionIntent, GroundingContext } from '@/modules/ai/AiProviderClient';

export type { AiActionIntent, GroundingContext };

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatSource {
  sourceId: string;
  url: string;
  title: string;
  domain: string;
  retrievedAt: number;
  relevantText: string;
  confidence: number;
  requestId: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  status: 'sending' | 'complete' | 'error' | 'streaming';
  error?: string;
  /** Document the message is grounded in. */
  documentId?: string;
  /** Evidence/citations for research answers. */
  sources?: ChatSource[];
  /** Provenance for document-grounded answers. */
  context?: { pages?: number[]; sections?: string[] };
}

export interface Conversation {
  id: string;
  title: string;
  documentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatPersistence {
  saveMessage(message: ChatMessage): Promise<void>;
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  saveConversation(conversation: Conversation): Promise<void>;
  listConversations(): Promise<Conversation[]>;
  deleteConversation(conversationId: string): Promise<void>;
}
