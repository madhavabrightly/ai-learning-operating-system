import { NavLink } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { LayoutDashboard, BookOpen, History, Settings, Puzzle, BarChart3, PanelLeftClose, PanelLeft } from 'lucide-react';
import { useDependency } from '@/hooks/useContainer';
import { TOKENS } from '@/di/tokens';
import type { UIZustandApi } from '@/store/UIStore';

const NAV = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/workspace', label: 'Workspace', icon: BookOpen },
  { path: '/history', label: 'History', icon: History },
  { path: '/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/plugins', label: 'Plugins', icon: Puzzle },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const uiStore = useDependency<UIZustandApi>(TOKENS.uiStore);
  const sidebarOpen = uiStore((s) => s.sidebarOpen);
  const toggleSidebar = uiStore((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border bg-muted/30 transition-[width] duration-200',
        sidebarOpen ? 'w-56' : 'w-14',
      )}
    >
      <div className="flex items-center justify-end p-2">
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
        </button>
      </div>
      <nav className="flex-1 space-y-1 px-2">
        {NAV.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive ? 'bg-primary text-on-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            <item.icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            {sidebarOpen && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
