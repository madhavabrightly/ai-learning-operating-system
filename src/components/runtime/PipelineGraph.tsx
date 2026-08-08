import { useMemo } from 'react';
import type { RuntimeOrchestrator } from '@/runtime/scheduler/RuntimeOrchestrator';

interface PipelineGraphProps {
  orchestrator: RuntimeOrchestrator;
  tick: number;
}

const COLOR: Record<string, string> = {
  CREATED: 'fill-status-queued',
  QUEUED: 'fill-status-queued',
  WAITING: 'fill-status-queued',
  RUNNING: 'fill-status-running',
  RETRYING: 'fill-status-retrying',
  FALLBACK: 'fill-status-fallback',
  PARTIAL_SUCCESS: 'fill-status-success',
  SUCCESS: 'fill-status-success',
  FAILED: 'fill-status-failed',
  CANCELLED: 'fill-status-failed',
  TIMEOUT: 'fill-status-failed',
};

export function PipelineGraph({ orchestrator, tick }: PipelineGraphProps) {
  void tick;
  const tasks = Array.from(orchestrator.taskRegistry.values());

  const graph = useMemo(() => {
    const statuses = new Map(tasks.map((t) => [t.id, t.status]));
    const nodeDeps = new Map(tasks.map((t) => [t.id, new Set<string>()]));
    for (const pipeline of orchestrator['pipelines']?.values() ?? []) {
      for (const node of pipeline.nodes) {
        nodeDeps.set(node.id, new Set(node.dependencies));
      }
    }

    const cols: string[][] = [];
    const included = new Set<string>();

    const orderedNodes = [...nodeDeps.entries()]
      .sort(([, a], [, b]) => a.size - b.size)
      .map(([id]) => id);

    let remaining = orderedNodes.filter((id) => !included.has(id));
    while (remaining.length > 0) {
      const layer: string[] = [];
      const remainingIds = new Set(remaining);
      for (const id of remaining) {
        const deps = nodeDeps.get(id) ?? new Set();
        if ([...deps].every((d) => !remainingIds.has(d))) {
          layer.push(id);
        }
      }
      if (layer.length === 0) {
        layer.push(remaining[0]);
      }
      cols.push(layer);
      layer.forEach((id) => included.add(id));
      remaining = orderedNodes.filter((id) => !included.has(id));
    }

    const nodePositions = new Map<string, { x: number; y: number }>();
    const colWidth = 160;
    const rowHeight = 72;
    cols.forEach((col, colIndex) => {
      const yOffset = ((col.length - 1) * rowHeight) / 2;
      col.forEach((id, rowIndex) => {
        nodePositions.set(id, {
          x: 24 + colIndex * colWidth,
          y: 40 + rowIndex * rowHeight - yOffset,
        });
      });
    });

    return { nodePositions, statuses, nodeDeps };
  }, [tasks, orchestrator]);

  if (tasks.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
        No running pipelines. Click “Upload mock document” to start.
      </div>
    );
  }

  const positions = [...graph.nodePositions.values()];
  const maxX = Math.max(...positions.map((p) => p.x), 0) + 120;
  const maxY = Math.max(...positions.map((p) => p.y), 0) + 80;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <h3 className="mb-3 font-heading text-xs font-semibold uppercase text-muted-foreground">Pipeline DAG</h3>
      <div className="overflow-auto">
        <svg width={maxX} height={maxY} aria-label="Pipeline execution graph">
          {[...graph.nodePositions.entries()].map(([sourceId, sourcePos]) => {
            const deps = graph.nodeDeps.get(sourceId) ?? new Set();
            return [...deps].map((targetId) => {
              const targetPos = graph.nodePositions.get(targetId);
              if (!targetPos) return null;
              return (
                <line
                  key={`${sourceId}-${targetId}`}
                  x1={sourcePos.x}
                  y1={sourcePos.y}
                  x2={targetPos.x}
                  y2={targetPos.y}
                  className="stroke-border stroke-1"
                  markerEnd="url(#arrowhead)"
                />
              );
            });
          })}
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" className="fill-border" />
            </marker>
          </defs>
          {[...graph.nodePositions.entries()].map(([id, pos]) => (
            <g key={id} transform={`translate(${pos.x}, ${pos.y})`}>
              <rect
                x={-55}
                y={-24}
                width={110}
                height={48}
                rx={6}
                className={`transition-colors ${COLOR[graph.statuses.get(id) ?? 'CREATED']} stroke-border stroke-1`}
              />
              <text x={0} y={-4} textAnchor="middle" className="fill-foreground text-[9px] font-medium">
                {id}
              </text>
              <text x={0} y={10} textAnchor="middle" className="fill-foreground/80 text-[8px] uppercase">
                {graph.statuses.get(id)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
