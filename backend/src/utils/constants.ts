// Reserved usernames - cannot be used
// IMPORTANT: Keep in sync with frontend src/utils/constants.ts
export const RESERVED_USERNAMES = [
  // App routes (MUST match all top-level routes in App.tsx)
  'onboarding',
  'dashboard',
  'activity',
  'subscribers',
  'profile',
  'requests',
  'request',
  'settings',
  'edit-page',
  'templates',
  'updates',
  'subscribe',
  'new-request',
  'api',
  'auth',
  'login',
  'logout',
  'signup',
  'register',
  'payroll',           // /payroll routes
  'my-subscriptions',  // subscriber-facing subscription list
  'unsubscribe',       // email unsubscribe
  'verify',            // payroll verification /verify/:id
  'r',                 // public request pages /r/:token
  'payment',           // /payment/success

  // System/reserved words
  'admin',
  'administrator',
  'support',
  'help',
  'contact',
  'about',
  'terms',
  'privacy',
  'legal',
  'blog',
  'news',
  'press',
  'careers',
  'jobs',
  'team',
  'pricing',
  'features',
  'docs',
  'documentation',
  'developer',
  'developers',
  'app',
  'apps',
  'download',
  'mobile',
  'ios',
  'android',
  'web',
  'www',
  'mail',
  'email',
  'ftp',
  'cdn',
  'assets',
  'static',
  'media',
  'images',
  'img',
  'files',
  'uploads',

  // Brand protection
  'nate',
  'natepay',
  'official',
  'verified',
  'staff',
  'moderator',
  'mod',

  // Common reserved
  'root',
  'null',
  'undefined',
  'anonymous',
  'guest',
  'user',
  'users',
  'account',
  'accounts',
  'billing',
  'payments',
  'checkout',
  'webhooks',
  'webhook',
  'callback',
  'oauth',
  'sso',

  // Potential future routes
  'explore',
  'discover',
  'search',
  'trending',
  'popular',
  'new',
  'create',
  'edit',
  'delete',
  'manage',
  'inbox',
  'messages',
  'notifications',
  'feed',
  'home',
]

// Stripe Connect Express supported countries (2024)
// https://stripe.com/docs/connect/express-accounts#supported-countries
export const STRIPE_SUPPORTED_COUNTRIES: Record<string, string> = {
  // North America
  US: 'United States',
  CA: 'Canada',
  MX: 'Mexico',

  // Europe
  AT: 'Austria',
  BE: 'Belgium',
  BG: 'Bulgaria',
  HR: 'Croatia',
  CY: 'Cyprus',
  CZ: 'Czech Republic',
  DK: 'Denmark',
  EE: 'Estonia',
  FI: 'Finland',
  FR: 'France',
  DE: 'Germany',
  GR: 'Greece',
  HU: 'Hungary',
  IE: 'Ireland',
  IT: 'Italy',
  LV: 'Latvia',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  MT: 'Malta',
  NL: 'Netherlands',
  NO: 'Norway',
  PL: 'Poland',
  PT: 'Portugal',
  RO: 'Romania',
  SK: 'Slovakia',
  SI: 'Slovenia',
  ES: 'Spain',
  SE: 'Sweden',
  CH: 'Switzerland',
  GB: 'United Kingdom',

  // Asia Pacific
  AU: 'Australia',
  HK: 'Hong Kong',
  JP: 'Japan',
  MY: 'Malaysia',
  NZ: 'New Zealand',
  SG: 'Singapore',
  TH: 'Thailand',

  // Other
  AE: 'United Arab Emirates',
  BR: 'Brazil',
}

// Countries supported via Stripe Cross-Border Payouts
// These countries can receive payouts from a US-based platform
// https://docs.stripe.com/connect/cross-border-payouts
export const STRIPE_CROSS_BORDER_COUNTRIES: Record<string, string> = {
  // Africa
  NG: 'Nigeria',
  GH: 'Ghana',
  KE: 'Kenya',
  ZA: 'South Africa',
  // Add more as needed - Stripe supports 80+ countries for cross-border
}

// Countries where Stripe is NOT available at all
export const STRIPE_UNSUPPORTED_REGIONS = [
  'IN', // India - limited Stripe support
  'PK', // Pakistan
  'BD', // Bangladesh
]

// Check if country has native Stripe support
export function isStripeNativeSupported(countryCode: string): boolean {
  return countryCode.toUpperCase() in STRIPE_SUPPORTED_COUNTRIES
}

// Check if country is supported via cross-border payouts
export function isStripeCrossBorderSupported(countryCode: string): boolean {
  return countryCode.toUpperCase() in STRIPE_CROSS_BORDER_COUNTRIES
}

// Check if Stripe is available (either native or cross-border)
export function isStripeSupported(countryCode: string): boolean {
  const code = countryCode.toUpperCase()
  return code in STRIPE_SUPPORTED_COUNTRIES || code in STRIPE_CROSS_BORDER_COUNTRIES
}

export function getStripeSupportedCountries() {
  // Combine native and cross-border countries
  const allCountries = {
    ...STRIPE_SUPPORTED_COUNTRIES,
    ...STRIPE_CROSS_BORDER_COUNTRIES,
  }
  return Object.entries(allCountries).map(([code, name]) => ({
    code,
    name,
    crossBorder: code in STRIPE_CROSS_BORDER_COUNTRIES,
  }))
}
