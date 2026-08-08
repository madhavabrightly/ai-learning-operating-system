import type { Result } from '@/errors/types';

export type NoteAttachment =
  | { type: 'document'; documentId: string }
  | { type: 'page'; documentId: string; page: number }
  | { type: 'selection'; documentId: string; page: number; text: string; rect?: { x: number; y: number; width: number; height: number } }
  | { type: 'concept'; conceptId: string }
  | { type: 'formula'; formulaId: string }
  | { type: 'table'; tableId: string }
  | { type: 'figure'; figureId: string }
  | { type: 'question'; questionId: string };

export interface Note {
  id: string;
  workspaceId: string;
  content: string;
  attachment: NoteAttachment;
  createdAt: number;
  updatedAt: number;
}

export interface INotesService {
  create(workspaceId: string, content: string, attachment: NoteAttachment): Promise<Result<Note>>;
  update(noteId: string, content: string): Promise<Result<Note>>;
  delete(noteId: string): Promise<Result<void>>;
  listByWorkspace(workspaceId: string): Promise<Result<Note[]>>;
  listByAttachment(attachment: NoteAttachment): Promise<Result<Note[]>>;
}
