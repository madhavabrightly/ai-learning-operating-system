import { createContext } from 'react';
import type { ReactNode } from 'react';
import type { IContainer } from '@/di/types';

export const ContainerContext = createContext<IContainer | null>(null);

export function ContainerProvider({
  container,
  children,
}: {
  container: IContainer;
  children: ReactNode;
}) {
  return <ContainerContext.Provider value={container}>{children}</ContainerContext.Provider>;
}
