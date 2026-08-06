import { CssBaseline, ThemeProvider } from '@mui/material';
import { RouterProvider } from 'react-router';
import { router } from './routes';
import { AuthProvider } from './auth/AuthProvider';
import { opsMuiTheme } from './design-system/theme/muiTheme';

export default function App() {
  return <ThemeProvider theme={opsMuiTheme}><CssBaseline /><AuthProvider><RouterProvider router={router} /></AuthProvider></ThemeProvider>;
}
