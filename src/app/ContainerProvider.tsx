import { createContext, useRef } from 'react';
import type { IContainer } from '@/di/types';

export const ContainerContext = createContext<IContainer | null>(null);

export function ContainerProvider({
  container,
  children,
}: {
  container: IContainer;
  children: React.ReactNode;
}) {
  const ref = useRef(container);
  return <ContainerContext.Provider value={ref.current}>{children}</ContainerContext.Provider>;
}
