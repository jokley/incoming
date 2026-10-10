import { RouterProvider } from 'react-router';
import { router } from './routes';
import { AuthProvider } from './auth/AuthProvider';
import { OpsThemeProvider } from './design-system';

export default function App() {
  return <OpsThemeProvider><AuthProvider><RouterProvider router={router} /></AuthProvider></OpsThemeProvider>;
}
