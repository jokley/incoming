import { lazy, Suspense, useEffect, useMemo } from 'react';
import { ActiveEventProvider, useActiveEvent } from './events/ActiveEventProvider';
import { RouterProvider } from 'react-router';
import { createAppRouter } from './routes';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { OpsThemeProvider } from './design-system';

function EventWorkspace() {
  const { revision } = useActiveEvent();
  const router = useMemo(() => createAppRouter(), [revision]);
  useEffect(() => () => { router.dispose(); }, [router]);
  return <RouterProvider key={revision} router={router} />;
}
const AdministrationOnly = lazy(() => import('./components/Administration').then(module => ({default:module.Administration})));
function AuthenticatedWorkspace() {
  const { permissions } = useAuth();
  const fallback = permissions.isAdmin ? <Suspense fallback={<div>Administration wird geladen …</div>}><AdministrationOnly /></Suspense> : undefined;
  return <ActiveEventProvider administrationFallback={fallback}><EventWorkspace /></ActiveEventProvider>;
}
export default function App() {
  return <OpsThemeProvider><AuthProvider><AuthenticatedWorkspace /></AuthProvider></OpsThemeProvider>;
}
