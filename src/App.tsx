import { useEffect, useMemo } from 'react';
import { ContainerProvider } from '@/app/ContainerProvider';
import { Router } from '@/app/Router';
import { createContainer } from '@/services/containerInit';
import { TOKENS } from '@/di/tokens';
import type { UIZustandApi } from '@/store/UIStore';

export default function App() {
  const container = useMemo(() => createContainer(), []);

  // Global keyboard shortcuts: Shift+D toggles Developer Mode.
  useEffect(() => {
    const uiStore = container.resolve<UIZustandApi>(TOKENS.uiStore);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        uiStore.getState().toggleDeveloperMode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [container]);

  return (
    <ContainerProvider container={container}>
      <Router />
    </ContainerProvider>
  );
}
