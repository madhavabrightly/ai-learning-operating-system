import { useCallback, useState } from 'react';
import { Upload, FileText, X, RefreshCw } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { DocumentReference } from '@/modules/document/types/DocumentTypes';

export interface DocumentLibraryProps {
  documents: DocumentReference[];
  currentDocumentId?: string;
  uploading: boolean;
  error?: string;
  onUpload: (file: File) => void;
  onOpen: (documentId: string) => void;
  onDelete: (documentId: string) => void;
  onRefresh: () => void;
}

export function DocumentLibrary({
  documents,
  currentDocumentId,
  uploading,
  error,
  onUpload,
  onOpen,
  onDelete,
  onRefresh,
}: DocumentLibraryProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onUpload(file);
    },
    [onUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onUpload(file);
    },
    [onUpload],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Documents</h3>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label="Refresh documents"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* Upload drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          'flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed p-3 text-xs transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
        )}
      >
        <Upload className="h-4 w-4 text-muted-foreground" />
        <label className="cursor-pointer text-muted-foreground hover:text-foreground">
          {uploading ? 'Uploading…' : 'Upload document'}
          <input type="file" className="hidden" onChange={handleFileChange} accept=".pdf,.docx,.txt,.md,.html" />
        </label>
      </div>

      {error && (
        <p className="rounded border border-destructive/20 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">{error}</p>
      )}

      {/* Document list */}
      <div className="max-h-64 space-y-1 overflow-auto">
        {documents.length === 0 && !uploading && (
          <p className="py-4 text-center text-[11px] text-muted-foreground">No documents yet. Upload one to begin.</p>
        )}
        {documents.length === 0 && uploading && (
          <p className="py-4 text-center text-[11px] text-muted-foreground">Uploading first document…</p>
        )}
        {documents.map((doc) => (
          <div
            key={doc.id}
            className={cn(
              'flex items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors',
              currentDocumentId === doc.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60',
            )}
          >
            <button
              type="button"
              onClick={() => onOpen(doc.id)}
              className="flex min-w-0 flex-1 items-center gap-2"
            >
              <FileText className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <span className="truncate">{doc.title}</span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(doc.id)}
              className="ml-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover:opacity-100"
              aria-label={`Delete ${doc.title}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}