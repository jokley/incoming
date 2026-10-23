import { useEffect, useMemo } from 'react';
import { ActiveEventProvider, useActiveEvent } from './events/ActiveEventProvider';
import { RouterProvider } from 'react-router';
import { createAppRouter } from './routes';
import { AuthProvider } from './auth/AuthProvider';
import { OpsThemeProvider } from './design-system';

function EventWorkspace() {
  const { revision } = useActiveEvent();
  const router = useMemo(() => createAppRouter(), [revision]);
  useEffect(() => () => { router.dispose(); }, [router]);
  return <RouterProvider key={revision} router={router} />;
}
export default function App() {
  return <OpsThemeProvider><AuthProvider><ActiveEventProvider><EventWorkspace /></ActiveEventProvider></AuthProvider></OpsThemeProvider>;
}
