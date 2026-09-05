import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, Outlet } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth';
import { EventsProvider } from './lib/events';
import { Layout } from './components/Layout';
import { FullPageSpinner } from './components/ui';
import { ApiError } from './api/client';
import { useTheme } from './lib/theme';
import LoginPage from './pages/Login';
import SetupWizardPage from './pages/setup/SetupWizard';
import DashboardPage from './pages/Dashboard';
import ClientsPage from './pages/Clients';
import BansPage from './pages/Bans';
import GroupsPage from './pages/Groups';
import PermissionsPage, { PermissionOverviewPage } from './pages/Permissions';
import SystemPage from './pages/System';
import StatsPage from './pages/Stats';
import ComplaintsPage from './pages/Complaints';
import FilesPage from './pages/Files';
import RegisterPage from './pages/Register';
import LogsPage from './pages/Logs';
import SettingsPage from './pages/Settings';
import BackupsPage from './pages/Backups';
import UsersPage from './pages/Users';
import AuditPage from './pages/Audit';
import AccountPage from './pages/Account';
import HistoryPage from './pages/History';
import ClientProfilePage from './pages/ClientProfile';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof ApiError && [400, 401, 403, 404, 503].includes(error.status)) return false;
        return failureCount < 2;
      },
      staleTime: 5000,
      refetchOnWindowFocus: true,
    },
  },
});

function ThemedToaster() {
  const { mode } = useTheme();
  return <Toaster theme={mode} richColors position="top-right" closeButton />;
}

function Protected() {
  const { user, loading, needsSetup } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <EventsProvider>
      <Layout />
    </EventsProvider>
  );
}

function RequireCap({ cap }: { cap: string }) {
  const { can } = useAuth();
  if (!can(cap)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  { path: '/login', element: <PublicOnly><LoginPage /></PublicOnly> },
  { path: '/setup', element: <SetupWizardPage /> },
  { path: '/register', element: <PublicOnly><RegisterPage /></PublicOnly> },
  {
    path: '/',
    element: <Protected />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'clients', element: <ClientsPage /> },
      { path: 'bans', element: <BansPage /> },
      { path: 'groups', element: <GroupsPage /> },
      { path: 'permissions/overview/:cldbid/:cid', element: <PermissionOverviewPage /> },
      { path: 'permissions/:kind/:id', element: <PermissionsPage /> },
      { path: 'complaints', element: <ComplaintsPage /> },
      { path: 'stats', element: <StatsPage /> },
      { path: 'account', element: <AccountPage /> },
      { element: <RequireCap cap="history.view" />, children: [{ path: 'history', element: <HistoryPage /> }, { path: 'history/:uid', element: <ClientProfilePage /> }] },
      { element: <RequireCap cap="users.manage" />, children: [{ path: 'users', element: <UsersPage /> }] },
      { element: <RequireCap cap="audit.view" />, children: [{ path: 'audit', element: <AuditPage /> }] },
      { element: <RequireCap cap="logs.view" />, children: [{ path: 'logs', element: <LogsPage /> }] },
      { element: <RequireCap cap="settings.view" />, children: [{ path: 'settings', element: <SettingsPage /> }] },
      { element: <RequireCap cap="backups.view" />, children: [{ path: 'backups', element: <BackupsPage /> }] },
      { element: <RequireCap cap="system.view" />, children: [{ path: 'system', element: <SystemPage /> }] },
      { element: <RequireCap cap="files.view" />, children: [{ path: 'files', element: <FilesPage /> }] },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <ThemedToaster />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
