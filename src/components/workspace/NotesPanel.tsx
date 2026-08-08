import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Note } from '@/modules/notes/types/NotesTypes';
import type { NotesService } from '@/modules/notes/service/NotesService';

export interface NotesPanelProps {
  notesService: NotesService;
  workspaceId: string;
  documentId?: string;
  page?: number;
  selection?: string;
}

export function NotesPanel({ notesService, workspaceId, documentId, page, selection }: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const result = await notesService.listByWorkspace(workspaceId);
    if (result.success && result.data) setNotes(result.data);
    setLoaded(true);
  };

  // Load once on first mount.
  if (!loaded) void load();

  const create = async () => {
    if (!content.trim()) return;
    setLoading(true);
    const attachment = selection
      ? ({ type: 'selection', documentId: documentId ?? '', page: page ?? 1, text: selection } as const)
      : documentId
        ? ({ type: 'page', documentId, page: page ?? 1 } as const)
        : ({ type: 'document', documentId: documentId ?? 'workspace' } as const);
    const result = await notesService.create(workspaceId, content.trim(), attachment);
    if (result.success && result.data) {
      setNotes((prev) => [result.data!, ...prev]);
      setContent('');
    }
    setLoading(false);
  };

  const remove = async (noteId: string) => {
    await notesService.delete(noteId);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Notes</h3>
      <div className="mb-2 flex gap-2">
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create();
          }}
          placeholder={selection ? 'Note about your selection…' : 'Write a note…'}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={loading || !content.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        {notes.length === 0 && (
          <p className="text-xs text-muted-foreground">No notes yet. Select text or write a note to save it.</p>
        )}
        {notes.map((note) => (
          <div key={note.id} className="group rounded border border-border bg-muted/30 p-2">
            <div className="flex items-start justify-between gap-2">
              <p className="whitespace-pre-wrap text-sm text-foreground">{note.content}</p>
              <button
                type="button"
                onClick={() => void remove(note.id)}
                className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                aria-label="Delete note"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {note.attachment.type} · {new Date(note.createdAt).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
