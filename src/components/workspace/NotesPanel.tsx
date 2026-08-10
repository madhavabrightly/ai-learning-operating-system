import { useState, useEffect, useCallback } from 'react';
import { StickyNote, Plus, Trash2 } from 'lucide-react';
import type { NotesService } from '@/modules/notes/service/NotesService';
import type { Note, NoteAttachment } from '@/modules/notes/types/NotesTypes';

export interface NotesPanelProps {
  notesService: NotesService;
  workspaceId: string;
  documentId?: string;
  page?: number;
  selection?: string;
}

export function NotesPanel({ notesService, workspaceId, documentId, page, selection }: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await notesService.listByWorkspace(workspaceId);
    if (result.success) setNotes(result.data ?? []);
    setLoading(false);
  }, [notesService, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const handleCreateNote = useCallback(async () => {
    if (!selection) return;
    const attachment: NoteAttachment = documentId
      ? { type: 'selection', documentId, page: page ?? 1, text: selection }
      : { type: 'document', documentId: 'generic' };
    await notesService.create(workspaceId, selection, attachment);
    await load();
  }, [notesService, workspaceId, documentId, page, selection, load]);

  const handleDelete = useCallback(
    async (noteId: string) => {
      await notesService.delete(noteId);
      await load();
    },
    [notesService, load],
  );

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading notes…</p>;
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Notes</h3>
        {selection && (
          <button
            type="button"
            onClick={handleCreateNote}
            className="flex items-center gap-1 rounded border border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
          >
            <Plus className="h-3 w-3" /> Add note
          </button>
        )}
      </div>

      {notes.length === 0 && (
        <p className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          <span className="text-center">
            <StickyNote className="mx-auto mb-1 h-5 w-5 opacity-40" />
            No notes yet.
            <br />
            Select text to create one.
          </span>
        </p>
      )}

      <div className="flex-1 space-y-2 overflow-auto">
        {notes.map((note) => (
          <div key={note.id} className="rounded border border-border bg-muted/20 p-2">
            <p className="text-xs text-foreground">{note.content}</p>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                {new Date(note.updatedAt).toLocaleDateString()}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(note.id)}
                className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                aria-label="Delete note"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}