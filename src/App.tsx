import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ThemeProvider } from '@/lib/theme-context';
import { Layout } from '@/components/Layout';
import { DashboardPage } from '@/pages/Dashboard';
import { PlatformDashboard } from '@/pages/PlatformDashboard';
import { TasksPage } from '@/pages/Tasks';
import { TaskDetailPage } from '@/pages/TaskDetail';
import { AuthPage } from '@/pages/Auth';
import { LandingPage } from '@/pages/Landing';
import { OnboardingPage } from '@/pages/Onboarding';
import { UserManagementPage } from '@/pages/UserManagement';
import { OrgSettingsPage } from '@/pages/OrgSettings';
import { BillingPage } from '@/pages/Billing';
import { ProfilePage } from '@/pages/Profile';
import { PlatformOrganisations } from '@/pages/PlatformOrganisations';
import { PlatformOrgDetail } from '@/pages/PlatformOrgDetail';
import { PlatformUsers } from '@/pages/PlatformUsers';
import { PlatformBilling } from '@/pages/PlatformBilling';
import Demo from '@/pages/Demo';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});

/**
 * Unknown paths bounce to "/", but Google Ads click IDs (?gclid=...) arrive
 * on the URL — a plain `<Navigate to="/" />` drops the query string and the
 * click can never be attributed. Preserve it across the bounce.
 */
function CatchAll() {
  const location = useLocation();
  return <Navigate to={{ pathname: '/', search: location.search }} replace />;
}

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
    </div>
  );
}

function ProtectedRoute({
  children, requiredAdmin, requireOrg, requirePlatformAdmin,
}: {
  children: React.ReactNode;
  requiredAdmin?: boolean;
  requireOrg?: boolean;
  requirePlatformAdmin?: boolean;
}) {
  const { user, isLoading, isInitialized, isAdmin, isPlatformAdmin, canUsePlatformConsole, isTrialExpired } = useAuth();
  const location = useLocation();

  if (!isInitialized || isLoading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/auth" replace />;

  // Platform-only routes require platform admin rights on the account, not
  // that the session's active org happen to be unset — someone who holds
  // platform_admin AND is currently working inside an org (the switcher's
  // "Platform console" link) must still be let through.
  if (requirePlatformAdmin && !canUsePlatformConsole) {
    return <Navigate to="/dashboard" replace />;
  }

  // Platform admin cannot access org-level routes
  if (isPlatformAdmin && (requiredAdmin || requireOrg)) {
    return <Navigate to="/dashboard" replace />;
  }

  // Org admin routes require org admin role
  if (requiredAdmin && !isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  // Trial expired: only billing page is accessible
  if (isTrialExpired && location.pathname !== '/billing') {
    return <Navigate to="/billing" replace />;
  }

  return <Layout>{children}</Layout>;
}

/** Smart dashboard: platform admin sees platform overview, org users see task dashboard */
function SmartDashboard() {
  const { isPlatformAdmin, organization } = useAuth();
  // Someone inside an organisation gets that workspace, even if they also hold
  // the platform role — arriving from another app should land you where you
  // came to work, not on the platform console. The console stays reachable
  // from the organisation switcher.
  if (organization) return <DashboardPage />;
  return isPlatformAdmin ? <PlatformDashboard /> : <DashboardPage />;
}

function AppRoutes() {
  const { user, isLoading, isInitialized } = useAuth();

  if (!isInitialized || isLoading) return <LoadingSpinner />;

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
      {/* Google Ads final URLs for the live search campaign — render the
          landing page directly (no redirect) so the click's attribution
          params are never at risk of being dropped. */}
      <Route path="/get-started" element={user ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
      <Route path="/track-tasks" element={user ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
      <Route path="/auth" element={user ? <Navigate to="/dashboard" replace /> : <AuthPage />} />
      <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <OnboardingPage />} />
      <Route path="/demo" element={<Demo />} />

      {/* Protected routes */}
      <Route path="/dashboard" element={<ProtectedRoute><SmartDashboard /></ProtectedRoute>} />
      <Route path="/tasks" element={<ProtectedRoute requireOrg><TasksPage /></ProtectedRoute>} />
      {/* Same page, scoped to one department (General / Digicom / Livecom …) */}
      <Route path="/tasks/d/:key" element={<ProtectedRoute requireOrg><TasksPage /></ProtectedRoute>} />
      <Route path="/tasks/:id" element={<ProtectedRoute requireOrg><TaskDetailPage /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />

      {/* Admin routes (org-level) */}
      <Route path="/billing" element={<ProtectedRoute requiredAdmin><BillingPage /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute requiredAdmin><UserManagementPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute requiredAdmin requireOrg><OrgSettingsPage /></ProtectedRoute>} />

      {/* Platform admin routes */}
      <Route path="/platform/organisations" element={<ProtectedRoute requirePlatformAdmin><PlatformOrganisations /></ProtectedRoute>} />
      <Route path="/platform/organisations/:id" element={<ProtectedRoute requirePlatformAdmin><PlatformOrgDetail /></ProtectedRoute>} />
      <Route path="/platform/users" element={<ProtectedRoute requirePlatformAdmin><PlatformUsers /></ProtectedRoute>} />
      <Route path="/platform/billing" element={<ProtectedRoute requirePlatformAdmin><PlatformBilling /></ProtectedRoute>} />

      <Route path="*" element={<CatchAll />} />
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AuthProvider>
            <AppRoutes />
            <Toaster position="top-right" richColors />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
