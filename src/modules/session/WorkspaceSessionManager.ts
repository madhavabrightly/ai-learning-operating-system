import type { IEventBus } from '@/events/types';
import { EventTopics } from '@/events/EventTopics';
import type { ILogger } from '@/logging/ILogger';
import type { ISessionEngine, SessionSnapshot } from '@/modules/session/types/SessionTypes';
import type { WorkspaceContextState } from '@/modules/workspace/types/WorkspaceTypes';
import type { DocumentStore } from '@/store/DocumentStore';
import type { UseBoundStore, StoreApi } from 'zustand';

export interface SessionSource {
  documentStore: UseBoundStore<StoreApi<DocumentStore>>;
  getNotes: () => Record<string, string>;
  getCurrentTab: () => string;
}

export interface WorkspaceSessionManager {
  /** Persist the real current workspace state. */
  save(): Promise<void>;
  /** Restore the last saved workspace snapshot. */
  restore(): Promise<SessionSnapshot | undefined>;
}

/**
 * Real session manager: snapshots the actual workspace state (open document,
 * page, selection, chat conversation, notes) through the SessionEngine and
 * restores it after a refresh. No fake state — everything saved is real.
 */
export function createWorkspaceSessionManager(
  engine: ISessionEngine,
  eventBus: IEventBus,
  logger: ILogger,
  source: SessionSource,
  workspaceId = 'workspace-default',
): WorkspaceSessionManager {
  let lastSavedAt = 0;
  const SAVE_DEBOUNCE_MS = 800;

  const buildSnapshot = async (): Promise<SessionSnapshot> => {
    const docState = source.documentStore.getState();

    const context: WorkspaceContextState = {
      documentId: docState.currentDocumentId,
      page: docState.page,
      selection: docState.selection,
    };

    return {
      id: workspaceId,
      workspaceId,
      currentPage: `page-${docState.page ?? 1}`,
      tabs: docState.currentDocumentId
        ? [{ id: docState.currentDocumentId, documentId: docState.currentDocumentId, title: docState.currentDocument?.title ?? 'Document', active: true }]
        : [],
      activeTabId: docState.currentDocumentId,
      panels: [],
      context,
      notes: source.getNotes(),
      selectedText: docState.selection ? { [docState.selection.text]: docState.selection.text } : {},
      scrollPositions: {},
      updatedAt: Date.now(),
    };
  };

  return {
    async save() {
      const now = Date.now();
      if (now - lastSavedAt < SAVE_DEBOUNCE_MS) return;
      try {
        const snapshot = await buildSnapshot();
        await engine.save(snapshot);
        lastSavedAt = now;
        eventBus.publish(EventTopics.SESSION_SAVED, { workspaceId, updatedAt: snapshot.updatedAt }, 'client');
      } catch (e) {
        logger.warn('Session save failed', { error: e instanceof Error ? e.message : String(e) });
      }
    },

    async restore() {
      try {
        const snapshot = await engine.load(workspaceId);
        if (!snapshot) return undefined;

        const docState = source.documentStore.getState();
        if (snapshot.context.documentId) {
          const exists = docState.documents.some((d) => d.id === snapshot.context.documentId);
          if (exists) {
            await docState.open(snapshot.context.documentId);
            if (snapshot.context.page) docState.setPage(snapshot.context.page);
            if (snapshot.context.selection) docState.setSelection(snapshot.context.selection);
          }
        }

        eventBus.publish(EventTopics.SESSION_RESTORED, { workspaceId, updatedAt: snapshot.updatedAt }, 'client');
        return snapshot;
      } catch (e) {
        logger.warn('Session restore failed', { error: e instanceof Error ? e.message : String(e) });
        return undefined;
      }
    },
  };
}
