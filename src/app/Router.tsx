import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { MainLayout } from '@/components/layouts/MainLayout';
import { DashboardPage } from '@/components/pages/DashboardPage';
import { WorkspacePage } from '@/components/pages/WorkspacePage';
import { HistoryPage } from '@/components/pages/HistoryPage';
import { SettingsPage } from '@/components/pages/SettingsPage';
import { PluginsPage } from '@/components/pages/PluginsPage';
import { AnalyticsPage } from '@/components/pages/AnalyticsPage';
import { GlobalErrorFallback } from '@/components/GlobalErrorFallback';

function RouteErrorBoundary() {
  return <GlobalErrorFallback error={new Error('Route failed')} resetErrorBoundary={() => window.location.reload()} />;
}

export function Router() {
  const router = createBrowserRouter([
    {
      path: '/',
      element: (
        <ErrorBoundary FallbackComponent={GlobalErrorFallback}>
          <MainLayout />
        </ErrorBoundary>
      ),
      errorElement: <RouteErrorBoundary />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'workspace', element: <WorkspacePage /> },
        { path: 'history', element: <HistoryPage /> },
        { path: 'analytics', element: <AnalyticsPage /> },
        { path: 'plugins', element: <PluginsPage /> },
        { path: 'settings', element: <SettingsPage /> },
      ],
    },
  ]);

  return <RouterProvider router={router} />;
}
