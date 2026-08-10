import { useMemo, useRef } from 'react';
import type { ParsedDocument, DocumentBlock } from '@/modules/document/model/DocumentModel';
import { MathRenderer } from './MathRenderer';

export interface DocumentViewerProps {
  document: ParsedDocument;
  page: number;
  zoom: number;
  onPageChange: (page: number) => void;
  onSelectText: (text: string) => void;
}

/**
 * Real document viewer over the canonical model. Renders blocks with KaTeX
 * math, real tables, figures, and lets the user select text to ask the AI.
 */
export function DocumentViewer({ document, page, zoom, onPageChange, onSelectText }: DocumentViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pages = document.pages ?? [];
  const currentPage = pages[page - 1];
  const totalPages = document.metadata?.pageCount || pages.length;

  const blocksByPage = useMemo(() => {
    const map = new Map<number, DocumentBlock[]>();
    for (const p of pages) map.set(p.index, p.blocks);
    return map;
  }, [pages]);

  const handleSelect = () => {
    const selection = window.getSelection()?.toString().trim();
    if (selection) onSelectText(selection);
  };

  if (!currentPage) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No pages available. Upload a document to begin.
      </div>
    );
  }

  const blocks = blocksByPage.get(page) ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between rounded border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="truncate font-medium text-foreground">{document.title}</span>
        <span>
          Page {page} / {totalPages}
        </span>
      </div>
      <div
        ref={containerRef}
        className="relative flex-1 overflow-auto rounded-lg border border-border bg-background p-6"
        role="textbox"
        aria-label="Document content — select text to ask the AI"
        aria-multiline="true"
        tabIndex={0}
        onMouseUp={handleSelect}
        onKeyUp={handleSelect}
      >
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }} className="mx-auto max-w-3xl">
          <div className="space-y-4">
            {blocks.map((block) => (
              <BlockRenderer
                key={block.id}
                block={block}
                document={document}
                pageIndex={page}
              />
            ))}
            {blocks.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {currentPage.needsOcr
                  ? 'This page contains no extractable text (scanned image). OCR is required.'
                  : 'No blocks extracted for this page.'}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Prev
        </button>
        <input
          type="range"
          min={1}
          max={totalPages}
          value={page}
          onChange={(e) => onPageChange(Number(e.target.value))}
          className="w-40 accent-primary"
          aria-label="Page slider"
        />
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="rounded border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function BlockRenderer({ block, document, pageIndex }: { block: DocumentBlock; document: ParsedDocument; pageIndex: number }) {
  switch (block.type) {
    case 'heading':
      return <h3 className="pt-2 text-lg font-semibold text-foreground">{block.text}</h3>;
    case 'list':
      return (
        <ul className={`ml-4 list-disc space-y-0.5 text-sm text-foreground ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
          {block.items?.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case 'code':
      return (
        <pre className="overflow-x-auto rounded border border-border bg-muted/40 p-3 text-xs text-foreground">
          <code>{block.text}</code>
        </pre>
      );
    case 'quote':
      return <blockquote className="border-l-2 border-primary pl-3 text-sm italic text-muted-foreground">{block.text}</blockquote>;
    case 'caption':
      return <p className="text-xs text-muted-foreground">{block.text}</p>;
    case 'formula': {
      const formula = block.formulaId ? document.formulas?.find((f) => f.id === block.formulaId) : undefined;
      if (!formula) return <p className="text-sm text-muted-foreground">[formula]</p>;
      return (
        <div className="rounded border border-border/60 bg-muted/20 px-3 py-2">
          <MathRenderer tex={formula.tex} inline={formula.inline} fallbackText={formula.fallbackText} />
          <span className="mt-1 block text-[10px] text-muted-foreground">Formula · page {formula.page}</span>
        </div>
      );
    }
    case 'table': {
      const table = block.tableId ? document.tables?.find((t) => t.id === block.tableId) : document.tables?.find((t) => t.page === pageIndex);
      if (!table) return <p className="text-sm text-muted-foreground">[table]</p>;
      return (
        <div className="overflow-x-auto rounded border border-border">
          {table.caption && <p className="bg-muted/40 px-3 py-1 text-xs text-muted-foreground">{table.caption}</p>}
          <table className="w-full border-collapse text-sm">
            {table.headers.length > 0 && (
              <thead>
                <tr>
                  {table.headers.map((h, i) => (
                    <th key={i} className="border border-border bg-muted/30 px-2 py-1 text-left font-medium text-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border border-border px-2 py-1 text-foreground">
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {table.reduced && (
            <p className="bg-accent/10 px-3 py-1 text-[10px] text-accent">Reduced structure — full grid not preserved</p>
          )}
        </div>
      );
    }
    case 'figure': {
      const figure = block.figureId ? document.figures?.find((f) => f.id === block.figureId) : undefined;
      const anyFigure = document.figures?.find((f) => f.page === pageIndex);
      const fig = figure ?? anyFigure;
      if (!fig) return <p className="text-sm text-muted-foreground">[figure]</p>;
      return (
        <div className="rounded border border-border bg-muted/10 p-2">
          {fig.imageUrl ? (
            <img src={fig.imageUrl} alt={fig.caption ?? 'Figure'} className="max-h-72 rounded" />
          ) : (
            <div className="flex h-32 items-center justify-center rounded bg-muted/40 text-xs text-muted-foreground">
              Figure region (page {fig.page}) — image not rasterized
            </div>
          )}
          {fig.caption && <p className="mt-1 text-xs text-muted-foreground">{fig.caption}</p>}
        </div>
      );
    }
    case 'text':
    default:
      return <p className="text-sm leading-relaxed text-foreground">{block.text}</p>;
  }
}
