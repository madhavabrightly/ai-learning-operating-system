import { v4 as uuid } from 'uuid';
import { ok } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import { EventTopics } from '@/events/EventTopics';
import type { IEventBus } from '@/events/types';
import type { ICache } from '@/cache/types';
import type { INotesService, Note, NoteAttachment } from '../types/NotesTypes';

const NOTES_CACHE_KEY = 'aios-notes';

export class NotesService implements INotesService {
  private notes = new Map<string, Note>();

  constructor(private readonly cache: ICache, private readonly eventBus: IEventBus) {}

  async create(workspaceId: string, content: string, attachment: NoteAttachment): Promise<Result<Note>> {
    await this.hydrate();
    const note: Note = {
      id: uuid(),
      workspaceId,
      content,
      attachment,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.notes.set(note.id, note);
    await this.persist();
    this.eventBus.publish(EventTopics.NOTE_CREATED, { note }, 'client');
    this.eventBus.publish(EventTopics.NOTES_UPDATED, { workspaceId }, 'client');
    return ok(note);
  }

  async update(noteId: string, content: string): Promise<Result<Note>> {
    await this.hydrate();
    const note = this.notes.get(noteId);
    if (!note) return { success: false, error: `Note ${noteId} not found`, retryable: false, fallbackAvailable: false };
    note.content = content;
    note.updatedAt = Date.now();
    await this.persist();
    this.eventBus.publish(EventTopics.NOTE_UPDATED, { note }, 'client');
    this.eventBus.publish(EventTopics.NOTES_UPDATED, { workspaceId: note.workspaceId }, 'client');
    return ok(note);
  }

  async delete(noteId: string): Promise<Result<void>> {
    await this.hydrate();
    const note = this.notes.get(noteId);
    this.notes.delete(noteId);
    await this.persist();
    if (note) {
      this.eventBus.publish(EventTopics.NOTE_DELETED, { noteId }, 'client');
      this.eventBus.publish(EventTopics.NOTES_UPDATED, { workspaceId: note.workspaceId }, 'client');
    }
    return ok(undefined);
  }

  async listByWorkspace(workspaceId: string): Promise<Result<Note[]>> {
    await this.hydrate();
    const list = [...this.notes.values()].filter((n) => n.workspaceId === workspaceId).sort((a, b) => b.updatedAt - a.updatedAt);
    return ok(list);
  }

  async listByAttachment(attachment: NoteAttachment): Promise<Result<Note[]>> {
    await this.hydrate();
    const list = [...this.notes.values()].filter((n) => attachmentsEqual(n.attachment, attachment)).sort((a, b) => b.updatedAt - a.updatedAt);
    return ok(list);
  }

  private async hydrate(): Promise<void> {
    if (this.notes.size > 0) return;
    const result = await this.cache.get<Note[]>(NOTES_CACHE_KEY);
    if (result.success && result.data) {
      for (const note of result.data) {
        this.notes.set(note.id, note);
      }
    }
  }

  private async persist(): Promise<void> {
    await this.cache.set(NOTES_CACHE_KEY, [...this.notes.values()]);
  }
}

function attachmentsEqual(a: NoteAttachment, b: NoteAttachment): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'document':
      return a.documentId === (b as { type: 'document'; documentId: string }).documentId;
    case 'page':
      return a.documentId === (b as { type: 'page'; documentId: string; page: number }).documentId && a.page === (b as { type: 'page'; documentId: string; page: number }).page;
    case 'selection':
      return (
        a.documentId === (b as { type: 'selection'; documentId: string }).documentId &&
        a.page === (b as { type: 'selection'; documentId: string; page: number }).page &&
        a.text === (b as { type: 'selection'; documentId: string; page: number; text: string }).text
      );
    case 'concept':
      return a.conceptId === (b as { type: 'concept'; conceptId: string }).conceptId;
    case 'formula':
      return a.formulaId === (b as { type: 'formula'; formulaId: string }).formulaId;
    case 'table':
      return a.tableId === (b as { type: 'table'; tableId: string }).tableId;
    case 'figure':
      return a.figureId === (b as { type: 'figure'; figureId: string }).figureId;
    case 'question':
      return a.questionId === (b as { type: 'question'; questionId: string }).questionId;
    default:
      return false;
  }
}
