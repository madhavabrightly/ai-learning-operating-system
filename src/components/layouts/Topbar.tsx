import { useEffect, useState } from 'react';
import { Command } from 'lucide-react';
import { useDependency } from '@/hooks/useContainer';
import { TOKENS } from '@/di/tokens';
import type { UIZustandApi } from '@/store/UIStore';

export function Topbar() {
  const uiStore = useDependency<UIZustandApi>(TOKENS.uiStore);
  const devMode = uiStore((s) => s.developerMode);
  const showDevBadge = devMode;

  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-muted/30 px-4">
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded bg-primary" aria-hidden="true" />
        <h1 className="font-heading text-sm font-semibold text-foreground">AI Learning OS</h1>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {showDevBadge && <span className="rounded bg-accent px-2 py-0.5 text-on-primary">Dev Mode</span>}
        <KeyboardHint />
      </div>
    </header>
  );
}

function KeyboardHint() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShow(false), 6000);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;
  return (
    <span className="hidden items-center gap-1 md:flex">
      <Command className="h-3 w-3" />
      <span>Shift + D</span>
      <span className="opacity-60">developer mode</span>
    </span>
  );
}
