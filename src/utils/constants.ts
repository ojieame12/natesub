// Reserved routes - these cannot be used as usernames
// Includes all app routes and common reserved words

export const RESERVED_ROUTES = [
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
] as const

export type ReservedRoute = typeof RESERVED_ROUTES[number]

// Check if a username is reserved
export function isReservedUsername(username: string): boolean {
  return RESERVED_ROUTES.includes(username.toLowerCase() as ReservedRoute)
}

// ============================================
// DOMAIN CONFIGURATION
// ============================================

// Primary domain for public pages (creator URLs)
export const PUBLIC_DOMAIN = import.meta.env.VITE_PUBLIC_PAGE_DOMAIN || 'natepay.co'

// Full URL for public pages (with protocol)
export const PUBLIC_PAGE_URL = import.meta.env.VITE_PUBLIC_PAGE_URL || `https://${PUBLIC_DOMAIN}`

// Get full URL to a creator's public page
export function getPublicPageUrl(username: string): string {
  return `${PUBLIC_PAGE_URL}/${username}`
}

// Get shareable link (short format for display, without https://)
export function getShareableLink(username: string): string {
  return `${PUBLIC_DOMAIN}/${username}`
}

// Get shareable link with protocol
export function getShareableLinkFull(username: string): string {
  return `https://${PUBLIC_DOMAIN}/${username}`
}
