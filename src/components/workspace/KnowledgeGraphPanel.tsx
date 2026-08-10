import { useState, useEffect, useCallback } from 'react';
import { Network } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { GraphService } from '@/modules/graph/service/GraphService';
import type { KnowledgeGraph, Concept, ConceptRelationship } from '@/modules/graph/types/GraphTypes';
import type { ChatStore } from '@/store/ChatStore';
import type { UseBoundStore, StoreApi } from 'zustand';

export interface KnowledgeGraphPanelProps {
  graphService: GraphService;
  documentId?: string;
  document?: unknown;
  chatStore: UseBoundStore<StoreApi<ChatStore>>;
  onNavigateToPage: (page: number) => void;
  onSelectText: (text: string) => void;
}

const TYPE_LABELS: Record<ConceptRelationship['type'], string> = {
  prerequisite: 'needs',
  related: 'related',
  part_of: 'part of',
  leads_to: 'leads to',
};

export function KnowledgeGraphPanel({ graphService, documentId, document: _document, chatStore }: KnowledgeGraphPanelProps) {
  const [graph, setGraph] = useState<KnowledgeGraph | undefined>();
  const [selected, setSelected] = useState<Concept | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const loadGraph = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setError(undefined);
    const result = await graphService.load(documentId);
    if (result.success) {
      setGraph(result.data);
    } else {
      setError(result.error ?? 'Failed to load graph');
    }
    setLoading(false);
  }, [graphService, documentId]);

  useEffect(() => { void loadGraph(); }, [loadGraph]);

  const selectConcept = (concept: Concept) => {
    setSelected(concept);
    void chatStore.getState().runAction('explain', {
      documentId,
      selection: concept.label,
    });
  };

  if (loading) return <p className="text-xs text-muted-foreground">Extracting knowledge graph…</p>;
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!graph) {
    return (
      <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
        <span className="text-center">
          <Network className="mx-auto mb-1 h-5 w-5 opacity-40" />
          No knowledge graph yet.
          <br />
          Open a document to extract concepts.
        </span>
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          Knowledge Graph ({graph.concepts.length} concepts)
        </h3>
      </div>

      <div className="flex-1 space-y-1 overflow-auto">
        {graph.concepts.map((concept) => (
          <button
            key={concept.id}
            type="button"
            onClick={() => selectConcept(concept)}
            className={cn(
              'w-full rounded border p-2 text-left text-xs transition-colors',
              selected?.id === concept.id
                ? 'border-primary bg-primary/10'
                : 'border-border bg-muted/20 hover:bg-muted',
            )}
          >
            <div className="font-medium text-foreground">{concept.label}</div>
            {concept.description && (
              <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{concept.description}</p>
            )}
            {concept.mastery !== undefined && (
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${concept.mastery * 100}%` }} />
                </div>
                <span className="text-[9px] text-muted-foreground">{Math.round(concept.mastery * 100)}%</span>
              </div>
            )}
          </button>
        ))}
      </div>

      {graph.relationships.length > 0 && (
        <div className="rounded border border-border bg-muted/20 p-2">
          <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Relationships</p>
          <div className="space-y-0.5">
            {graph.relationships.slice(0, 8).map((rel) => (
              <p key={rel.id} className="text-[10px] text-muted-foreground">
                <span className="text-foreground">{rel.source}</span>{' '}
                <span className="text-primary">{TYPE_LABELS[rel.type] ?? rel.type}</span>{' '}
                <span className="text-foreground">{rel.target}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}