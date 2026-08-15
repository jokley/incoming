import { createTheme } from '@mui/material/styles';
import { opsLightThemeTokens, opsThemeTokens as t } from './tokens';

export const createOpsMuiTheme = (mode: 'light' | 'dark') => {
  const c = mode === 'dark' ? t.color : { ...t.color, ...opsLightThemeTokens.color };
  return createTheme({
  palette: {
    mode, background: { default: c.background, paper: c.surface }, primary: { main: c.primary, dark: c.primaryEmphasis, contrastText: c.onAccent },
    secondary: { main: c.secondary, contrastText: c.onAccent }, success: { main: c.success, contrastText: c.onAccent }, warning: { main: c.warning, contrastText: c.onAccent },
    error: { main: c.error, contrastText: c.onAccent }, info: { main: c.info, contrastText: c.onAccent }, divider: c.divider,
    text: { primary: c.text, secondary: c.textMuted, disabled: c.textSubtle },
  },
  shape: { borderRadius: 12 },
  spacing: t.layout.spacing,
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: t.typography.display,
    h2: t.typography.pageTitle,
    h3: t.typography.title,
    h4: t.typography.sectionTitle,
    body1: t.typography.body,
    caption: t.typography.caption,
    subtitle1: t.typography.bodyStrong,
    subtitle2: t.typography.label,
    button: { fontWeight: 700, textTransform: 'none' },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: t.layout.radius.md, transition: t.motion.transition.normal, '&:focus-visible': { boxShadow: t.layout.shadow.focus } },
      },
    },
    MuiCard: { styleOverrides: { root: { backgroundImage: 'none', backgroundColor: c.surface, border: `1px solid ${c.border}`, boxShadow: t.layout.shadow.sm } } },
    MuiChip: { styleOverrides: { root: { borderRadius: t.layout.radius.sm, fontWeight: 750, '&:focus-visible': { boxShadow: t.layout.shadow.focus } } } },
    MuiDialog: { styleOverrides: { paper: { backgroundImage: 'none', backgroundColor: c.surface, border: `1px solid ${c.border}`, boxShadow: t.layout.shadow.lg } } },
    MuiDrawer: { styleOverrides: { paper: { backgroundImage: 'none', borderColor: c.border } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: c.surfaceOverlay, border: `1px solid ${c.border}`, boxShadow: t.layout.shadow.md } } },
    MuiTableCell: { styleOverrides: { root: { borderBottomColor: c.divider } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: t.layout.radius.md, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: c.focus, boxShadow: t.layout.shadow.focus } } } },
    MuiMenuItem: { styleOverrides: { root: { borderRadius: t.layout.radius.sm, '&.Mui-focusVisible': { backgroundColor: c.surfaceElevated } } } },
  },
  });
};

export const opsMuiTheme = createOpsMuiTheme('dark');
