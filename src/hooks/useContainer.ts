import { useContext } from 'react';
import { ContainerContext } from '@/app/ContainerProvider';
import type { IContainer } from '@/di/types';

export function useContainer(): IContainer {
  const container = useContext(ContainerContext);
  if (!container) throw new Error('useContainer must be used within a ContainerProvider');
  return container;
}

export function useDependency<T>(token: symbol): T {
  const container = useContainer();
  return container.resolve<T>(token) as T;
}
