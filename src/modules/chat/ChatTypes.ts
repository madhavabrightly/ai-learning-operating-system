// ---------------------------------------------------------------------------
// Chat message, conversation, and persistence interfaces
// ---------------------------------------------------------------------------

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
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  status: 'sending' | 'streaming' | 'complete' | 'error';
  documentId?: string;
  sources?: ChatSource[];
  error?: string;
  /** Reasoning/thinking tokens streamed by reasoning models (e.g. delta.reasoning). */
  reasoning?: string;
}

export interface Conversation {
  id: string;
  title: string;
  documentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatPersistence {
  saveConversation(conversation: Conversation): Promise<void>;
  getConversation(conversationId: string): Promise<Conversation | undefined>;
  saveMessage(message: ChatMessage): Promise<void>;
  listConversations(): Promise<Conversation[]>;
  listMessages(conversationId: string): Promise<ChatMessage[]>;
  deleteMessage(messageId: string): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
}