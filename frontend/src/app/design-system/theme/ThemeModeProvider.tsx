import { CssBaseline, ThemeProvider } from '@mui/material';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createOpsMuiTheme } from './muiTheme';

type ThemeMode = 'light' | 'dark';
const ThemeModeContext = createContext<{ mode: ThemeMode; toggle: () => void }>({ mode: 'dark', toggle: () => undefined });

export function OpsThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => localStorage.getItem('ops-theme') === 'light' ? 'light' : 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem('ops-theme', mode);
  }, [mode]);
  const value = useMemo(() => ({ mode, toggle: () => setMode(current => current === 'dark' ? 'light' : 'dark') }), [mode]);
  const theme = useMemo(() => createOpsMuiTheme(mode), [mode]);
  return <ThemeModeContext.Provider value={value}><ThemeProvider theme={theme}><CssBaseline />{children}</ThemeProvider></ThemeModeContext.Provider>;
}

export const useOpsTheme = () => useContext(ThemeModeContext);
