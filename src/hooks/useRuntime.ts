import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useDependency } from './useContainer';
import { TOKENS } from '@/di/tokens';
import { RuntimeOrchestrator } from '@/runtime/scheduler/RuntimeOrchestrator';
import type { Task } from '@/runtime/types';

export function useRuntime() {
  const orchestrator = useDependency<RuntimeOrchestrator>(TOKENS.orchestrator);

  const [, setTick] = useState(0);

  useEffect(() => {
    const unsubscribe = orchestrator.onStatusChange(() => setTick((t) => t + 1));
    return () => { unsubscribe(); };
  }, [orchestrator]);

  const tasks = Array.from(orchestrator.taskRegistry.values());

  const runDemo = useCallback(
    (documentId?: string) => {
      orchestrator.start();
      const eventBus = (orchestrator as unknown as { eventBus?: { publish: (topic: string, payload: unknown) => void } }).eventBus;
      eventBus?.publish('demo.pipeline.start', { documentId });
    },
    [orchestrator],
  );

  const reset = useCallback(() => {
    orchestrator.stop();
    orchestrator.start();
  }, [orchestrator]);

  return { orchestrator, tasks, runDemo, reset };
}

function subscribeTasks(orchestrator: RuntimeOrchestrator, callback: () => void) {
  return orchestrator.onStatusChange(callback);
}

// WeakMap keeps the last cached snapshot per orchestrator so useSyncExternalStore
// receives referentially-equal data when nothing has changed, avoiding React's
// "The result of getSnapshot should be cached" warning.
const taskCache = new WeakMap<RuntimeOrchestrator, { key: string; tasks: Task[] }>();

function buildTasksKey(tasks: Task[]): string {
  return tasks.map((t) => `${t.id}:${t.status}:${t.progress}`).join('|');
}

function getTasksSnapshot(orchestrator: RuntimeOrchestrator): Task[] {
  const next = Array.from(orchestrator.taskRegistry.values());
  const cached = taskCache.get(orchestrator);
  if (cached) {
    const nextKey = buildTasksKey(next);
    if (nextKey === cached.key) {
      return cached.tasks;
    }
  }
  taskCache.set(orchestrator, { key: buildTasksKey(next), tasks: next });
  return next;
}

export function useRuntimeTasks() {
  const orchestrator = useDependency<RuntimeOrchestrator>(TOKENS.orchestrator);
  return useSyncExternalStore(
    (cb) => subscribeTasks(orchestrator, cb),
    () => getTasksSnapshot(orchestrator),
    () => getTasksSnapshot(orchestrator),
  );
}
