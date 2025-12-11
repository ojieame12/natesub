// Reserved routes - these cannot be used as usernames
// Includes all app routes and common reserved words

export const RESERVED_ROUTES = [
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
] as const

export type ReservedRoute = typeof RESERVED_ROUTES[number]

// Check if a username is reserved
export function isReservedUsername(username: string): boolean {
  return RESERVED_ROUTES.includes(username.toLowerCase() as ReservedRoute)
}

// Public page URL helper
export function getPublicPageUrl(username: string): string {
  // In production, this would use the PUBLIC_PAGE_URL env var
  // For now, we'll use a relative path that works in dev
  const baseUrl = import.meta.env.VITE_PUBLIC_PAGE_URL || window.location.origin
  return `${baseUrl}/${username}`
}

// Get shareable link (short format for display)
export function getShareableLink(username: string): string {
  // Display format - uses the production domain
  const domain = import.meta.env.VITE_PUBLIC_PAGE_DOMAIN || 'natepay.co'
  return `${domain}/${username}`
}
