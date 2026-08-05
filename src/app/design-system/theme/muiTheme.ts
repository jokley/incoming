import { createTheme } from '@mui/material/styles';
import { opsThemeTokens as t } from './tokens';

export const opsMuiTheme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: t.color.background, paper: t.color.surface },
    primary: { main: t.color.primary, dark: t.color.primaryEmphasis, contrastText: t.color.onAccent },
    secondary: { main: t.color.secondary, contrastText: t.color.onAccent },
    success: { main: t.color.success, contrastText: t.color.onAccent },
    warning: { main: t.color.warning, contrastText: t.color.onAccent },
    error: { main: t.color.error, contrastText: t.color.onAccent },
    info: { main: t.color.info, contrastText: t.color.onAccent },
    divider: t.color.divider,
    text: { primary: t.color.text, secondary: t.color.textMuted, disabled: t.color.textSubtle },
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
    MuiCard: { styleOverrides: { root: { backgroundImage: 'none', backgroundColor: t.color.surface, border: `1px solid ${t.color.border}`, boxShadow: t.layout.shadow.sm } } },
    MuiChip: { styleOverrides: { root: { borderRadius: t.layout.radius.sm, fontWeight: 750, '&:focus-visible': { boxShadow: t.layout.shadow.focus } } } },
    MuiDialog: { styleOverrides: { paper: { backgroundImage: 'none', backgroundColor: t.color.surface, border: `1px solid ${t.color.border}`, boxShadow: t.layout.shadow.lg } } },
    MuiDrawer: { styleOverrides: { paper: { backgroundImage: 'none', borderColor: t.color.border } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: t.color.surfaceOverlay, border: `1px solid ${t.color.border}`, boxShadow: t.layout.shadow.md } } },
    MuiTableCell: { styleOverrides: { root: { borderBottomColor: t.color.divider } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: t.layout.radius.md, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: t.color.focus, boxShadow: t.layout.shadow.focus } } } },
    MuiMenuItem: { styleOverrides: { root: { borderRadius: t.layout.radius.sm, '&.Mui-focusVisible': { backgroundColor: t.color.surfaceElevated } } } },
  },
});
