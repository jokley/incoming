export const opsThemeTokens = {
  color: {
    background: '#08111F',
    surface: '#111C2E',
    surfaceRaised: '#142238',
    surfaceElevated: '#17263D',
    surfaceOverlay: '#1D2F4A',
    border: '#2D4260',
    borderStrong: '#3E5C82',
    divider: '#21344F',
    focus: '#93C5FD',
    primary: '#93C5FD',
    primaryEmphasis: '#5B9DFF',
    secondary: '#7DD3FC',
    success: '#6EE7B7',
    warning: '#FCD34D',
    error: '#FDA4AF',
    info: '#93C5FD',
    text: '#E5EDF7',
    textMuted: '#A8B6C8',
    textSubtle: '#CBD5E1',
    onAccent: '#06101E',
    tone: {
      neutral: { border: '#3E5C82', surface: 'rgba(148, 163, 184, 0.14)', text: '#E5EDF7' },
      primary: { border: 'rgba(147, 197, 253, 0.56)', surface: 'rgba(91, 157, 255, 0.18)', text: '#DBEAFE' },
      success: { border: 'rgba(110, 231, 183, 0.56)', surface: 'rgba(16, 185, 129, 0.18)', text: '#D1FAE5' },
      warning: { border: 'rgba(252, 211, 77, 0.6)', surface: 'rgba(245, 158, 11, 0.2)', text: '#FEF3C7' },
      error: { border: 'rgba(253, 164, 175, 0.6)', surface: 'rgba(244, 63, 94, 0.18)', text: '#FFE4E6' },
      info: { border: 'rgba(125, 211, 252, 0.56)', surface: 'rgba(14, 165, 233, 0.18)', text: '#E0F2FE' },
    },
  },
  typography: {
    display: { fontSize: '2rem', lineHeight: 1.15, fontWeight: 750, letterSpacing: '-0.03em' },
    pageTitle: { fontSize: '1.5rem', lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.02em' },
    title: { fontSize: '1.125rem', lineHeight: 1.3, fontWeight: 700, letterSpacing: '-0.01em' },
    sectionTitle: { fontSize: '0.8125rem', lineHeight: 1.2, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' },
    body: { fontSize: '0.875rem', lineHeight: 1.5, fontWeight: 500 },
    bodyStrong: { fontSize: '0.875rem', lineHeight: 1.5, fontWeight: 700 },
    caption: { fontSize: '0.75rem', lineHeight: 1.35, fontWeight: 500 },
    label: { fontSize: '0.6875rem', lineHeight: 1.2, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' },
    kpi: { fontSize: '1.75rem', lineHeight: 1, fontWeight: 800, letterSpacing: '-0.03em' },
  },
  layout: {
    spacing: 8,
    maxWidth: '1980px',
    radius: { xs: '0.375rem', sm: '0.5rem', md: '0.75rem', lg: '1rem', xl: '1.25rem', xxl: '1.75rem', full: '9999px' },
    shadow: {
      xs: '0 1px 2px rgba(3, 10, 24, 0.24)',
      sm: '0 8px 24px rgba(3, 10, 24, 0.22)',
      md: '0 18px 60px rgba(3, 10, 24, 0.32)',
      lg: '0 28px 90px rgba(3, 10, 24, 0.42)',
      focus: '0 0 0 3px rgba(147, 197, 253, 0.38)',
    },
  },
  motion: {
    duration: { instant: '0ms', fast: '120ms', normal: '180ms', slow: '260ms' },
    easing: { standard: 'cubic-bezier(0.2, 0, 0, 1)', emphasized: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    transition: { fast: '120ms cubic-bezier(0.2, 0, 0, 1)', normal: '180ms cubic-bezier(0.2, 0, 0, 1)', slow: '260ms cubic-bezier(0.16, 1, 0.3, 1)' },
  },
} as const;

export const opsLightThemeTokens = {
  color: {
    background: '#F3F6FA', surface: '#FFFFFF', surfaceRaised: '#F8FAFC', surfaceElevated: '#EEF3F8', surfaceOverlay: '#E4ECF5',
    border: '#C7D2E0', borderStrong: '#91A4BC', divider: '#D8E0EA', focus: '#2563EB', primary: '#2563EB', primaryEmphasis: '#1D4ED8',
    secondary: '#0369A1', success: '#047857', warning: '#A16207', error: '#BE123C', info: '#0369A1', text: '#142033', textMuted: '#52647A', textSubtle: '#64748B', onAccent: '#FFFFFF',
  },
} as const;

export type OpsThemeTokens = typeof opsThemeTokens;
