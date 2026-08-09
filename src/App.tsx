import { useMemo } from 'react';
import { ContainerProvider } from '@/app/ContainerProvider';
import { Router } from '@/app/Router';
import { createContainer } from '@/services/containerInit';

export default function App() {
  const container = useMemo(() => createContainer(), []);

  return (
    <ContainerProvider container={container}>
      <Router />
    </ContainerProvider>
  );
}
