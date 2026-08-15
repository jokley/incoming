import { createTheme } from '@mui/material/styles';
import { opsLightThemeTokens, opsThemeTokens as t } from './tokens';

export const createOpsMuiTheme = (mode: 'light' | 'dark') => {
  const c = mode === 'dark' ? t.color : { ...t.color, ...opsLightThemeTokens.color };
  const shadow = mode === 'dark' ? t.layout.shadow : {
    ...t.layout.shadow,
    sm: '0 8px 24px rgba(30, 48, 72, 0.11)',
    md: '0 18px 60px rgba(30, 48, 72, 0.16)',
    lg: '0 28px 90px rgba(30, 48, 72, 0.22)',
    focus: '0 0 0 3px rgba(37, 99, 235, 0.25)',
  };
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
        root: { borderRadius: t.layout.radius.md, transition: t.motion.transition.normal, '&:focus-visible': { boxShadow: shadow.focus } },
      },
    },
    MuiCard: { styleOverrides: { root: { backgroundImage: 'none', backgroundColor: c.surface, border: `1px solid ${c.border}`, boxShadow: shadow.sm } } },
    MuiChip: { styleOverrides: { root: { borderRadius: t.layout.radius.sm, fontWeight: 750, '&:focus-visible': { boxShadow: shadow.focus } } } },
    MuiDialog: { styleOverrides: { paper: { backgroundImage: 'none', backgroundColor: c.surface, border: `1px solid ${c.border}`, boxShadow: shadow.lg } } },
    MuiDrawer: { styleOverrides: { paper: { backgroundImage: 'none', borderColor: c.border } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: c.surfaceOverlay, border: `1px solid ${c.border}`, boxShadow: shadow.md } } },
    MuiTableCell: { styleOverrides: { root: { borderBottomColor: c.divider } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: t.layout.radius.md, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: c.focus, boxShadow: shadow.focus } } } },
    MuiMenuItem: { styleOverrides: { root: { borderRadius: t.layout.radius.sm, '&.Mui-focusVisible': { backgroundColor: c.surfaceElevated } } } },
  },
  });
};

export const opsMuiTheme = createOpsMuiTheme('dark');
