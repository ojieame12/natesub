// Reserved usernames - cannot be used
export const RESERVED_USERNAMES = [
  // App routes
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

// Countries where Stripe is NOT available (common requests)
export const STRIPE_UNSUPPORTED_REGIONS = [
  'NG', // Nigeria - use Flutterwave/Paystack
  'GH', // Ghana - use Flutterwave/Paystack
  'KE', // Kenya - use Flutterwave/Paystack
  'ZA', // South Africa - use Flutterwave/Paystack
  'IN', // India - limited Stripe support
  'PK', // Pakistan
  'BD', // Bangladesh
  'PH', // Philippines
]

export function isStripeSupported(countryCode: string): boolean {
  return countryCode.toUpperCase() in STRIPE_SUPPORTED_COUNTRIES
}

export function getStripeSupportedCountries() {
  return Object.entries(STRIPE_SUPPORTED_COUNTRIES).map(([code, name]) => ({
    code,
    name,
  }))
}
