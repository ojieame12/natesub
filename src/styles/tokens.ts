/**
 * Design System Tokens
 *
 * These reference CSS custom properties defined in index.css.
 * Use these in JS when you need programmatic access to design values.
 * For CSS, use the custom properties directly (e.g., var(--accent-primary))
 */

export const colors = {
  // Brand
  accent: {
    primary: 'var(--accent-primary)',      // #FF941A
    gradient: 'var(--brand-gradient)',
  },

  // Neutrals (warm stone)
  neutral: {
    50: 'var(--neutral-50)',    // #FAFAF9
    100: 'var(--neutral-100)',  // #F5F5F4
    200: 'var(--neutral-200)',  // #E7E5E4
    300: 'var(--neutral-300)',  // #D6D3D1
    400: 'var(--neutral-400)',  // #A8A29E
    500: 'var(--neutral-500)',  // #78716C
    600: 'var(--neutral-600)',  // #57534E
    700: 'var(--neutral-700)',  // #44403C
    800: 'var(--neutral-800)',  // #292524
    900: 'var(--neutral-900)',  // #1C1917
    950: 'var(--neutral-950)',  // #0C0A09
  },

  // Semantic
  text: {
    primary: 'var(--text-primary)',
    secondary: 'var(--text-secondary)',
    tertiary: 'var(--text-tertiary)',
  },

  // Status
  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
} as const

export const spacing = {
  xs: 'var(--space-xs)',     // 4px
  sm: 'var(--space-sm)',     // 8px
  md: 'var(--space-md)',     // 16px
  lg: 'var(--space-lg)',     // 24px
  xl: 'var(--space-xl)',     // 32px
  '2xl': 'var(--space-2xl)', // 40px
  '3xl': 'var(--space-3xl)', // 48px
  '4xl': 'var(--space-4xl)', // 56px
  '5xl': 'var(--space-5xl)', // 64px
} as const

export const radius = {
  sm: 'var(--radius-sm)',    // 10px
  md: 'var(--radius-md)',    // 14px
  lg: 'var(--radius-lg)',    // 18px
  xl: 'var(--radius-xl)',    // 24px
  '2xl': 'var(--radius-2xl)', // 28px
  full: 'var(--radius-full)', // 9999px
} as const

export const shadows = {
  sm: 'var(--shadow-sm)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
  card: 'var(--shadow-card)',
  // 3D button shadow
  button3d: '0 4px 0 var(--neutral-700)',
  buttonPressed: '0 2px 0 var(--neutral-700)',
} as const

export const typography = {
  fontFamily: {
    primary: 'var(--font-primary)',  // SF Compact Rounded
  },
  fontSize: {
    xs: '12px',
    sm: '13px',
    base: '15px',
    lg: '17px',
    xl: '20px',
    '2xl': '24px',
    '3xl': '28px',
    '4xl': '32px',
  },
  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const

export const transitions = {
  fast: '0.1s ease',
  normal: '0.15s ease',
  slow: '0.3s ease',
  spring: '0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const

export const zIndex = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  modalBackdrop: 100,
  modal: 101,
  toast: 9999,
} as const

// Convenience export
export const tokens = {
  colors,
  spacing,
  radius,
  shadows,
  typography,
  transitions,
  zIndex,
} as const

export default tokens
