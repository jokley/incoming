export const opsThemeTokens = {
  color: {
    background: '#08111F',
    surface: '#111C2E',
    surfaceElevated: '#17263D',
    border: '#2D4260',
    divider: '#21344F',
    primary: '#5B9DFF',
    secondary: '#7DD3FC',
    success: '#34D399',
    warning: '#FBBF24',
    error: '#FB7185',
    info: '#60A5FA',
    text: '#E5EDF7',
    textMuted: '#93A4BA',
    textSubtle: '#64748B',
  },
  typography: {
    display: { fontSize: '2rem', lineHeight: 1.15, fontWeight: 750, letterSpacing: '-0.03em' },
    pageTitle: { fontSize: '1.5rem', lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.02em' },
    sectionTitle: { fontSize: '0.8125rem', lineHeight: 1.2, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' },
    body: { fontSize: '0.875rem', lineHeight: 1.5, fontWeight: 500 },
    caption: { fontSize: '0.75rem', lineHeight: 1.35, fontWeight: 500 },
    label: { fontSize: '0.6875rem', lineHeight: 1.2, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' },
    kpi: { fontSize: '1.75rem', lineHeight: 1, fontWeight: 800, letterSpacing: '-0.03em' },
  },
  layout: {
    spacing: 8,
    maxWidth: '1980px',
    radius: { sm: '0.5rem', md: '0.75rem', lg: '1rem', xl: '1.25rem', xxl: '1.75rem' },
    shadow: {
      sm: '0 8px 24px rgba(3, 10, 24, 0.22)',
      md: '0 18px 60px rgba(3, 10, 24, 0.32)',
      focus: '0 0 0 3px rgba(91, 157, 255, 0.28)',
    },
  },
  motion: { fast: '120ms ease-out', normal: '180ms ease-out', slow: '260ms ease-out' },
} as const;

export type OpsThemeTokens = typeof opsThemeTokens;
