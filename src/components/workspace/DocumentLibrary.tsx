import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, FileText, Trash2, RefreshCw } from 'lucide-react';
import type { ParsedDocument } from '@/modules/document/model/DocumentModel';
import { cn } from '@/utils/cn';

export interface DocumentLibraryProps {
  documents: ParsedDocument[];
  currentDocumentId?: string;
  uploading: boolean;
  error?: string;
  onUpload: (file: File) => Promise<void>;
  onOpen: (documentId: string) => Promise<void>;
  onDelete: (documentId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

const STATUS_COLOR: Record<string, string> = {
  READY: 'text-status-success',
  PROCESSING: 'text-status-running',
  UPLOADING: 'text-status-running',
  PARTIAL: 'text-status-retrying',
  FAILED: 'text-status-failed',
};

export function DocumentLibrary({ documents, currentDocumentId, uploading, error, onUpload, onOpen, onDelete, onRefresh }: DocumentLibraryProps) {
  const [dragOver, setDragOver] = useState(false);

  const onDrop = useCallback(
    (accepted: File[]) => {
      for (const file of accepted) void onUpload(file);
    },
    [onUpload],
  );

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt'],
      'text/markdown': ['.md', '.markdown'],
    },
    multiple: true,
  });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        onDragEnter={() => setDragOver(true)}
        onDragLeave={() => setDragOver(false)}
        className={cn(
          'cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/30',
        )}
      >
        <input {...getInputProps()} />
        <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium text-foreground">
          {uploading ? 'Processing…' : 'Drop a study document here, or click to browse'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">PDF, DOCX, TXT, Markdown · up to 50 MB</p>
      </div>

      {error && (
        <div role="alert" className="rounded border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Documents ({documents.length})</h3>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="inline-flex items-center gap-1 rounded p-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Refresh documents"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-2">
        {documents.length === 0 && !uploading && (
          <p className="rounded border border-dashed border-border bg-muted/10 p-4 text-center text-xs text-muted-foreground">
            No documents yet. Upload your first study document.
          </p>
        )}
        {documents.map((doc) => (
          <div
            key={doc.id}
            className={cn(
              'group flex items-center gap-2 rounded-lg border p-2 transition-colors',
              currentDocumentId === doc.id ? 'border-primary bg-primary/5' : 'border-border bg-muted/30 hover:bg-muted/60',
            )}
          >
            <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <button type="button" onClick={() => void onOpen(doc.id)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
              <p className="text-[10px] text-muted-foreground">
                {doc.metadata.format.toUpperCase()} · {doc.metadata.pageCount} pages ·{' '}
                <span className={STATUS_COLOR[doc.status] ?? ''}>{doc.status}</span>
                {doc.metadata.requiresOcr && ' · OCR required'}
              </p>
            </button>
            <button
              type="button"
              onClick={() => void onDelete(doc.id)}
              className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              aria-label={`Delete ${doc.title}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
