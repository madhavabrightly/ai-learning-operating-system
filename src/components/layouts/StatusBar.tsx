import { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { useDependency } from '@/hooks/useContainer';
import { TOKENS } from '@/di/tokens';
import type { ISocketClient } from '@/socket/types';

export function StatusBar() {
  const socket = useDependency<ISocketClient>(TOKENS.socketClient);
  const [status, setStatus] = useState(socket.status);

  useEffect(() => {
    const id = setInterval(() => setStatus(socket.status), 1000);
    return () => clearInterval(id);
  }, [socket]);

  const connected = status === 'connected';

  return (
    <footer className="flex h-7 items-center justify-between border-t border-border bg-muted/30 px-3 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          {connected ? <Wifi className="h-3 w-3 text-green-500" /> : <WifiOff className="h-3 w-3 text-muted-foreground" />}
          <span className="uppercase">{status}</span>
        </div>
        <span>Ready</span>
      </div>
      <div className="flex items-center gap-3">
        <span>v0.0.1</span>
      </div>
    </footer>
  );
}
