import type { WorkspaceContextState } from '@/modules/workspace/types/WorkspaceTypes';

export interface TabState {
  id: string;
  documentId: string;
  title: string;
  active: boolean;
}

export interface PanelState {
  id: string;
  width: number;
  height?: number;
  visible: boolean;
  order: number;
}

export interface SessionSnapshot {
  id: string;
  workspaceId: string;
  currentPage: string;
  tabs: TabState[];
  activeTabId?: string;
  panels: PanelState[];
  context: WorkspaceContextState;
  notes: Record<string, string>;
  selectedText?: Record<string, string>;
  scrollPositions: Record<string, number>;
  updatedAt: number;
}

export interface ISessionEngine {
  save(snapshot: SessionSnapshot): Promise<void>;
  load(workspaceId: string): Promise<SessionSnapshot | undefined>;
  list(): Promise<SessionSnapshot[]>;
}
