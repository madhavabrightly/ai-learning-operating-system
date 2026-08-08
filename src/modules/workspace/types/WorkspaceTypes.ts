export interface PanelDefinition {
  id: string;
  label: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  minHeight?: number;
  dockable?: boolean;
}

export interface WorkspaceLayout {
  panels: WorkspacePanelState[];
}

export interface WorkspacePanelState {
  id: string;
  width: number;
  height?: number;
  visible: boolean;
  order: number;
  focused?: boolean;
}

export interface WorkspaceContextState {
  documentId?: string;
  page?: number;
  selection?: { text: string; rect?: { x: number; y: number; width: number; height: number } };
  conceptId?: string;
  formulaId?: string;
  tableId?: string;
  figureId?: string;
  questionId?: string;
}
