import { useEffect } from 'react';
import type { EventListener, IEventBus } from '@/events/types';
import { useDependency } from './useContainer';
import { TOKENS } from '@/di/tokens';

export function useEvent<T = unknown>(topic: string, listener: EventListener<T>) {
  const eventBus = useDependency<IEventBus>(TOKENS.eventBus);
  useEffect(() => {
    const unsubscribe = eventBus.subscribe(topic, listener);
    return () => { unsubscribe(); };
  }, [topic, listener, eventBus]);
}
