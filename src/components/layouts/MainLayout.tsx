import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { StatusBar } from './StatusBar';
import { DeveloperMode } from '@/components/DeveloperMode';

export function MainLayout() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Topbar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-auto p-4">
            <Outlet />
          </div>
          <StatusBar />
          <DeveloperMode />
        </main>
      </div>
    </div>
  );
}
