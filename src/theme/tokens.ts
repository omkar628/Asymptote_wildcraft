export const colors = {
  forest900: '#123C2D',
  deepGreen: '#0B2B21',
  forest700: '#28664B',
  accentLime: '#C8F31D',
  limeTint: '#EFF9C9',
  canvas: '#F5F5EF',
  surface: '#FFFFFF',
  surfaceSecondary: '#E9EEE6',
  forest100: '#E9EEE6',
  neutral950: '#17231D',
  neutral700: '#5E6B63',
  neutral300: '#DCE3DB',
  disabled: '#98A49B',
  successGreen: '#247548',
  successSurface: '#E8F5EC',
  warningAmber: '#A96308',
  warningSurface: '#FFF2D6',
  warningText: '#A96308',
  alertRed: '#B42318',
  alertSurface: '#FDEAE8',
  offline: '#626C72',
  offlineSurface: '#E9ECEE',
  infoBlue: '#245F9E',
  infoSurface: '#EAF2FC',
} as const;

/** 4/8-point spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  screen: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  sheet: 20,
} as const;

export const radii = {
  sm: 8,
  button: 12,
  card: 16,
  sheet: 20,
  chip: 999,
  marker: 999,
  pill: 999,
} as const;

export const typography = {
  screenTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    lineHeight: 26,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 22,
  },
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
    lineHeight: 21,
  },
  bodyStrong: {
    fontSize: 15,
    fontWeight: '600' as const,
    lineHeight: 21,
  },
  meta: {
    fontSize: 13,
    fontWeight: '500' as const,
    lineHeight: 18,
  },
  value: {
    fontSize: 22,
    fontWeight: '700' as const,
    lineHeight: 26,
  },
  metric: {
    fontSize: 20,
    fontWeight: '700' as const,
    lineHeight: 24,
  },
} as const;

export const iconSize = {
  sm: 16,
  md: 20,
  nav: 22,
  marker: 18,
} as const;

export const motion = {
  press: 120,
  fast: 140,
  nav: 220,
  sheet: 240,
} as const;

export const elevation = {
  float: {
    shadowColor: '#0B2B21',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

export const nav = {
  height: 64,
  side: 16,
  bottomGap: 8,
  radius: 32,
} as const;

/** Space a scrolling tab screen needs so the floating bar does not cover the last row. */
export function tabContentInset(bottomInset: number): number {
  return bottomInset + nav.bottomGap + nav.height + spacing.screen;
}

/** Minimum field touch target from the design spec. */
export const minTouchTarget = 48;

/**
 * Inter is not bundled. Text uses the platform sans-serif so the first
 * build does not download a font package.
 */
export const fontFamily = undefined;
