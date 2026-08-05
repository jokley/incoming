import { createTheme } from '@mui/material/styles';
import { opsThemeTokens as t } from './tokens';

export const opsMuiTheme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: t.color.background, paper: t.color.surface },
    primary: { main: t.color.primary, contrastText: '#06101E' },
    secondary: { main: t.color.secondary, contrastText: '#06101E' },
    success: { main: t.color.success },
    warning: { main: t.color.warning },
    error: { main: t.color.error },
    info: { main: t.color.info },
    divider: t.color.divider,
    text: { primary: t.color.text, secondary: t.color.textMuted, disabled: t.color.textSubtle },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: t.typography.display,
    h2: t.typography.pageTitle,
    h3: t.typography.sectionTitle,
    body1: t.typography.body,
    caption: t.typography.caption,
    button: { fontWeight: 700, textTransform: 'none' },
  },
  components: {
    MuiButton: { styleOverrides: { root: { borderRadius: t.layout.radius.md, transition: t.motion.normal } } },
    MuiCard: { styleOverrides: { root: { backgroundImage: 'none', border: `1px solid ${t.color.border}`, boxShadow: t.layout.shadow.sm } } },
    MuiChip: { styleOverrides: { root: { borderRadius: t.layout.radius.sm, fontWeight: 750 } } },
    MuiDialog: { styleOverrides: { paper: { backgroundImage: 'none', border: `1px solid ${t.color.border}` } } },
    MuiDrawer: { styleOverrides: { paper: { backgroundImage: 'none', borderColor: t.color.border } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: t.color.surfaceElevated, border: `1px solid ${t.color.border}` } } },
    MuiTableCell: { styleOverrides: { root: { borderBottomColor: t.color.divider } } },
  },
});
