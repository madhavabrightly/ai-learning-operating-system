import { useEffect, useState } from 'react';
import { useDependency } from '@/hooks/useContainer';
import { TOKENS } from '@/di/tokens';
import type { ChatStore } from '@/store/ChatStore';
import type { Conversation } from '@/modules/chat/ChatTypes';
import type { UseBoundStore, StoreApi } from 'zustand';
import { MessageSquare, Trash2 } from 'lucide-react';

export function HistoryPage() {
  const chatStore = useDependency<UseBoundStore<StoreApi<ChatStore>>>(TOKENS.chatStore);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    const sub = chatStore.subscribe((s) => setConversations(s.conversations));
    void chatStore.getState().init().then(() => setConversations(chatStore.getState().conversations));
    return sub;
  }, [chatStore]);

  const remove = async (id: string) => {
    await chatStore.getState().deleteConversation(id);
    setConversations(chatStore.getState().conversations);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h2 className="font-heading text-lg font-semibold text-foreground">History</h2>
      {conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No conversations yet. Ask the AI assistant in the workspace.</p>
      ) : (
        <ul className="space-y-2">
          {conversations.map((c) => (
            <li key={c.id} className="group flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-3">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {c.title === 'New conversation' ? `Conversation ${c.id.slice(0, 8)}` : c.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(c.updatedAt).toLocaleString()}
                    {c.documentId ? ` · document ${c.documentId.slice(0, 8)}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void remove(c.id)}
                className="rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                aria-label="Delete conversation"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
