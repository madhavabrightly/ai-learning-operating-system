import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Network, X, BookOpen, MessageSquare, ExternalLink } from 'lucide-react';
import type { KnowledgeGraph, Concept } from '@/modules/graph/types/GraphTypes';
import type { GraphService } from '@/modules/graph/service/GraphService';
import type { ParsedDocument } from '@/modules/document/model/DocumentModel';
import type { ChatStore } from '@/store/ChatStore';
import type { UseBoundStore, StoreApi } from 'zustand';
import { cn } from '@/utils/cn';

export interface KnowledgeGraphPanelProps {
  graphService: GraphService;
  documentId?: string;
  document?: ParsedDocument;
  chatStore: UseBoundStore<StoreApi<ChatStore>>;
  onNavigateToPage: (page: number) => void;
  onSelectText?: (text: string) => void;
}

interface GraphNodeState {
  id: string;
  label: string;
  difficulty: string;
  sourcePage?: number;
  description?: string;
  x: number;
  y: number;
}

/**
 * Real knowledge graph explorer. Nodes and edges come from the actual
 * extracted concepts (AI or heuristic, with provenance). Clicking a node
 * shows its description, source location, related concepts, and lets the
 * user ask the AI about it.
 */
export function KnowledgeGraphPanel({
  graphService,
  documentId,
  document,
  chatStore,
  onNavigateToPage,
  onSelectText,
}: KnowledgeGraphPanelProps) {
  const [graph, setGraph] = useState<KnowledgeGraph>({ concepts: [], relationships: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [related, setRelated] = useState<{ prerequisites: Concept[]; related: Concept[] }>({ prerequisites: [], related: [] });
  const [query, setQuery] = useState('');

  const loadGraph = useCallback(async () => {
    if (!documentId) {
      setGraph({ concepts: [], relationships: [] });
      return;
    }
    setLoading(true);
    setError(null);
    const result = await graphService.load(documentId);
    if (result.success && result.data) {
      setGraph(result.data);
    } else {
      setError(result.error ?? 'Failed to load knowledge graph');
    }
    setLoading(false);
  }, [graphService, documentId]);

  useEffect(() => {
    // Load graph on mount / when the document changes.
    if (!documentId) return;
    let cancelled = false;
    graphService.load(documentId).then((result) => {
      if (cancelled) return;
      if (result.success && result.data) setGraph(result.data);
      else setError(result.error ?? 'Failed to load knowledge graph');
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [graphService, documentId]);

  const selectConcept = useCallback(
    async (conceptId: string) => {
      const result = await graphService.selectConcept(conceptId);
      if (result.success && result.data) {
        setSelectedConcept(result.data);
        const relatedResult = await graphService.getRelated(conceptId);
        if (relatedResult.success && relatedResult.data) setRelated(relatedResult.data);
      }
    },
    [graphService],
  );

  // Deterministic layout: circular arrangement of nodes.
  const nodes = useMemo<GraphNodeState[]>(() => {
    const concepts = graph.concepts;
    const visible = query.trim()
      ? concepts.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
      : concepts;
    const total = visible.length || 1;
    return visible.slice(0, 60).map((c, i) => {
      const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
      const radius = Math.max(110, total * 8);
      return {
        id: c.id,
        label: c.label,
        difficulty: c.difficulty ?? 'beginner',
        sourcePage: c.sourcePage,
        description: c.description,
        x: 200 + Math.cos(angle) * radius,
        y: 200 + Math.sin(angle) * radius,
      };
    });
  }, [graph.concepts, query]);

  const edges = useMemo(() => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    return graph.relationships.filter((r) => nodeIds.has(r.source) && nodeIds.has(r.target));
  }, [graph.relationships, nodes]);

  const findSource = (concept: Concept) => {
    if (!concept.sourcePage || !document) return;
    onNavigateToPage(concept.sourcePage);
    // Find text near the concept label on that page.
    if (onSelectText && concept.label) {
      const page = document.pages[concept.sourcePage - 1];
      if (page) {
        const idx = page.text.toLowerCase().indexOf(concept.label.toLowerCase());
        if (idx !== -1) {
          onSelectText(page.text.slice(Math.max(0, idx - 60), idx + concept.label.length + 120));
        }
      }
    }
  };

  const askAboutConcept = (concept: Concept) => {
    void chatStore.getState().sendMessage(`Explain the concept "${concept.label}" based on the document.`, { documentId });
  };

  const askAboutConceptWithSource = (concept: Concept) => {
    const page = concept.sourcePage && document ? document.pages[concept.sourcePage - 1] : undefined;
    const context = page ? page.text.slice(0, 2000) : concept.description;
    void chatStore.getState().sendMessage(`Explain "${concept.label}" using the following source text:\n\n${context ?? ''}`, { documentId });
  };

  if (!documentId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Open a document to explore its knowledge graph.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-background px-2 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search graph…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadGraph()}
          className="rounded-lg border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/80"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {loading && <p className="text-xs text-muted-foreground">Building graph from document content…</p>}
      {!loading && graph.concepts.length === 0 && (
        <p className="rounded border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          No concepts extracted yet. Run the document pipeline (Runtime Lab) to extract concepts from the document.
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        {/* Graph canvas */}
        <div className="relative min-h-[320px] flex-1 overflow-auto rounded-lg border border-border bg-background">
          <div className="relative h-[440px] w-[560px]">
            <svg className="absolute inset-0 h-full w-full" aria-label="Knowledge graph">
              {edges.map((edge, i) => {
                const src = nodes.find((n) => n.id === edge.source);
                const tgt = nodes.find((n) => n.id === edge.target);
                if (!src || !tgt) return null;
                return (
                  <line
                    key={`${edge.source}-${edge.target}-${i}`}
                    x1={src.x}
                    y1={src.y}
                    x2={tgt.x}
                    y2={tgt.y}
                    stroke="var(--color-border)"
                    strokeWidth={1}
                    strokeDasharray={edge.type === 'related' ? '3 3' : undefined}
                  />
                );
              })}
            </svg>
            {nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => void selectConcept(node.id)}
                className={cn(
                  'absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border px-2 py-1 text-center text-[10px] font-medium shadow-sm transition-colors',
                  selectedConcept?.id === node.id
                    ? 'border-primary bg-primary text-on-primary'
                    : 'border-border bg-muted/80 text-foreground hover:border-primary/50 hover:bg-muted',
                )}
                style={{ left: node.x, top: node.y, maxWidth: 120 }}
                title={node.label}
              >
                <Network className="mr-1 h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{node.label}</span>
              </button>
            ))}
            {nodes.length === 0 && !loading && (
              <p className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">No graph nodes.</p>
            )}
          </div>
        </div>

        {/* Concept detail */}
        <div className="flex min-h-0 flex-col gap-2 overflow-auto rounded-lg border border-border bg-muted/20 p-3">
          {selectedConcept ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-heading text-sm font-semibold text-foreground">{selectedConcept.label}</h3>
                <button
                  type="button"
                  onClick={() => setSelectedConcept(null)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                  aria-label="Close concept"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {selectedConcept.description && <p className="text-xs text-muted-foreground">{selectedConcept.description}</p>}
              <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 capitalize">{selectedConcept.difficulty}</span>
                {selectedConcept.sourcePage ? <span className="rounded bg-muted px-1.5 py-0.5">page {selectedConcept.sourcePage}</span> : null}
              </div>

              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => findSource(selectedConcept)}
                  disabled={!selectedConcept.sourcePage}
                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                >
                  <BookOpen className="h-3 w-3" />
                  Source
                </button>
                <button
                  type="button"
                  onClick={() => void askAboutConcept(selectedConcept)}
                  className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/5 px-2 py-1 text-[11px] text-primary transition-colors hover:bg-primary/10"
                >
                  <MessageSquare className="h-3 w-3" />
                  Ask AI
                </button>
                <button
                  type="button"
                  onClick={() => void askAboutConceptWithSource(selectedConcept)}
                  className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-muted"
                >
                  <ExternalLink className="h-3 w-3" />
                  Ask with source
                </button>
              </div>

              {(related.prerequisites.length > 0 || related.related.length > 0) && (
                <div className="mt-2 space-y-2">
                  {related.prerequisites.length > 0 && (
                    <div>
                      <p className="text-[10px] font-medium uppercase text-muted-foreground">Requires</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {related.prerequisites.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => void selectConcept(c.id)}
                            className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground hover:bg-muted/80"
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {related.related.length > 0 && (
                    <div>
                      <p className="text-[10px] font-medium uppercase text-muted-foreground">Related</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {related.related.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => void selectConcept(c.id)}
                            className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground hover:bg-muted/80"
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Select a concept node to see details, source location, related concepts, and AI actions.</p>
          )}

          {/* Relationship legend */}
          {edges.length > 0 && (
            <div className="mt-auto border-t border-border pt-2">
              <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Legend</p>
              <div className="space-y-0.5 text-[10px] text-muted-foreground">
                <p className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 bg-border" /> prerequisite
                </p>
                <p className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 border-t border-dashed border-border" /> related / part of
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
