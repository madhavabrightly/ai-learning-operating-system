import type { Result } from '@/errors/types';
import { ok } from '@/errors/ResultFactory';
import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';
import type { SessionEngine } from '@/modules/session/engine/SessionEngine';
import type { SessionSnapshot } from '@/modules/session/types/SessionTypes';
import type { DocumentStore } from '@/store/DocumentStore';
import type { StoreApi, UseBoundStore } from 'zustand';

export interface WorkspaceSessionManager {
  save(): Promise<Result<void>>;
  restore(): Promise<Result<void>>;
  list(): Promise<SessionSnapshot[]>;
}

export interface WorkspaceSessionManagerOptions {
  documentStore: UseBoundStore<StoreApi<DocumentStore>>;
  getNotes: () => Record<string, string>;
  getCurrentTab: () => string;
}

export function createWorkspaceSessionManager(
  engine: SessionEngine,
  eventBus: IEventBus,
  logger: ILogger,
  options: WorkspaceSessionManagerOptions,
): WorkspaceSessionManager {
  const workspaceId = 'workspace-default';

  return {
    async save() {
      const state = options.documentStore.getState();
      const snapshot: SessionSnapshot = {
        id: `session-${Date.now()}`,
        workspaceId,
        currentPage: `page-${state.page}`,
        tabs: state.currentDocumentId
          ? [
              {
                id: state.currentDocumentId,
                documentId: state.currentDocumentId,
                title: state.currentDocument?.title ?? 'Document',
                active: true,
              },
            ]
          : [],
        activeTabId: state.currentDocumentId,
        panels: [
          { id: 'library', width: 320, visible: true, order: 0 },
          { id: 'viewer', width: 640, visible: true, order: 1 },
        ],
        context: {
          documentId: state.currentDocumentId,
          page: state.page,
          selection: state.selection,
        },
        notes: options.getNotes(),
        scrollPositions: {},
        updatedAt: Date.now(),
      };
      await engine.save(snapshot);
      eventBus.publish('session.saved', { workspaceId }, 'client');
      return ok(undefined);
    },

    async restore() {
      const snapshot = await engine.load(workspaceId);
      if (!snapshot) return ok(undefined);
      eventBus.publish('session.restored', { workspaceId }, 'client');
      return ok(undefined);
    },

    async list() {
      return engine.list();
    },
  };
}