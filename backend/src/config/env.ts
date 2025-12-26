import { z } from 'zod'

function normalizeUrlEnv(value: unknown): unknown {
  if (typeof value !== 'string') return value
  // Strip whitespace aggressively to avoid broken URLs from env var copy/paste.
  const trimmed = value.trim().replace(/\s+/g, '')
  if (!trimmed) return trimmed

  // Fix accidental double scheme prefixes (e.g., "https://https://natepay.co").
  if (/^(https?:\/\/){2,}/i.test(trimmed)) {
    const withoutScheme = trimmed.replace(/^(https?:\/\/)+/i, '')
    const isLocalhost = /^(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)(:|$)/.test(withoutScheme)
    const protocol = isLocalhost ? 'http://' : 'https://'
    return `${protocol}${withoutScheme}`
  }

  // If already has a scheme, keep as-is.
  if (/^[a-zA-Z][a-zA-Z\\d+.-]*:\/\//.test(trimmed)) return trimmed

  // Default to https for production-ish hostnames; use http for localhost.
  const isLocalhost = /^(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)(:|$)/.test(trimmed)
  const protocol = isLocalhost ? 'http://' : 'https://'
  return `${protocol}${trimmed}`
}

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3001'),
  APP_URL: z.preprocess(normalizeUrlEnv, z.string().url()),
  API_URL: z.preprocess(normalizeUrlEnv, z.string().url()),
  PUBLIC_PAGE_URL: z.preprocess(normalizeUrlEnv, z.string().url()).default('https://natepay.co'), // Public creator pages

  // Database
  DATABASE_URL: z.string(),

  // Redis
  REDIS_URL: z.string().optional(),

  // Auth
  JWT_SECRET: z.string().min(32),
  MAGIC_LINK_SECRET: z.string().min(32),
  SESSION_SECRET: z.string().min(32),
  MAGIC_LINK_EXPIRES_MINUTES: z.string().default('30'),

  // Stripe
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  STRIPE_WEBHOOK_SECRET_CONNECT: z.string().startsWith('whsec_').optional()
    .or(z.literal(''))  // Allow empty string (treated as unset)
    .transform(v => v || undefined), // Convert empty string to undefined
  STRIPE_ONBOARDING_RETURN_URL: z.preprocess(normalizeUrlEnv, z.string().url()),
  STRIPE_ONBOARDING_REFRESH_URL: z.preprocess(normalizeUrlEnv, z.string().url()),

  // Paystack (for NG, KE, ZA)
  PAYSTACK_SECRET_KEY: z.string().startsWith('sk_').optional(),
  PAYSTACK_PUBLIC_KEY: z.string().startsWith('pk_').optional(),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional(),

  // Flutterwave (optional)
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_WEBHOOK_SECRET: z.string().optional(),

  // Email
  RESEND_API_KEY: z.string().startsWith('re_'),
  EMAIL_FROM: z.string(),
  EMAIL_LOGO_URL: z.preprocess(normalizeUrlEnv, z.string().url().optional()),

  // Cloudflare R2 Storage
  R2_ACCOUNT_ID: z.string(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET: z.string(),
  R2_PUBLIC_URL: z.preprocess(normalizeUrlEnv, z.string().url()),

  // Feature flags
  ENABLE_PAYSTACK: z.string().transform(v => v === 'true').default('false'),
  ENABLE_FLUTTERWAVE: z.string().transform(v => v === 'true').default('false'),
  ENABLE_SMS: z.string().transform(v => v === 'true').default('false'),

  // Bird SMS (formerly MessageBird)
  BIRD_ACCESS_KEY: z.string().optional(),
  BIRD_WORKSPACE_ID: z.string().optional(),
  BIRD_CHANNEL_ID: z.string().optional(),        // SMS channel ID
  BIRD_SENDER_ID: z.string().default('NatePay'), // Sender name (alphanumeric, max 11 chars)

  // Bird WhatsApp (same workspace, different channel)
  BIRD_WHATSAPP_CHANNEL_ID: z.string().optional(),
  ENABLE_WHATSAPP: z.string().transform(v => v === 'true').default('false'),

  // Slack Alerts
  SLACK_WEBHOOK_URL: z.string().url().optional(),

  // AI Services
  GOOGLE_AI_API_KEY: z.string().optional(),     // Gemini 3 Pro - voice + content generation
  PERPLEXITY_API_KEY: z.string().optional(),    // Sonar Pro - market research
  REPLICATE_API_TOKEN: z.string().optional(),   // Recraft V3 - logo generation

  // Jobs/Scheduler
  JOBS_API_KEY: z.string().min(16).optional(),  // API key for job endpoints (cron)

  // Encryption
  ENCRYPTION_KEY: z.string().min(32).optional(), // For encrypting PII (account numbers)

  // Testing
  PAYMENTS_MODE: z.enum(['live', 'test', 'stub']).default('live'),
})

function loadEnv() {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:')
    console.error(parsed.error.flatten().fieldErrors)
    process.exit(1)
  }

  const data = parsed.data

  // Production-only validations
  if (data.NODE_ENV === 'production') {
    // Testing flags must never run in production.
    if (data.PAYMENTS_MODE === 'stub') {
      console.error('❌ FATAL: PAYMENTS_MODE=stub is not allowed in production')
      process.exit(1)
    }

    // Stripe: Must use live keys in production
    if (!data.STRIPE_SECRET_KEY.startsWith('sk_live_')) {
      console.error('❌ FATAL: STRIPE_SECRET_KEY must be a live key (sk_live_*) in production')
      console.error('   Current key starts with:', data.STRIPE_SECRET_KEY.slice(0, 10) + '...')
      process.exit(1)
    }

    // Paystack: Must use live keys if enabled
    if (data.ENABLE_PAYSTACK && data.PAYSTACK_SECRET_KEY) {
      if (!data.PAYSTACK_SECRET_KEY.startsWith('sk_live_')) {
        console.error('❌ FATAL: PAYSTACK_SECRET_KEY must be a live key (sk_live_*) in production')
        process.exit(1)
      }
    }

    // Encryption key: Required in production for PII protection (account numbers, auth codes)
    if (!data.ENCRYPTION_KEY) {
      console.error('❌ FATAL: ENCRYPTION_KEY is required in production for PII protection')
      console.error('   Generate one with: openssl rand -base64 32')
      process.exit(1)
    }

    // URLs: Must be HTTPS in production
    if (!data.APP_URL.startsWith('https://')) {
      console.error('❌ FATAL: APP_URL must use HTTPS in production')
      process.exit(1)
    }
    if (!data.API_URL.startsWith('https://')) {
      console.error('❌ FATAL: API_URL must use HTTPS in production')
      process.exit(1)
    }

    console.log('✅ Production environment validated')
  }

  return data
}

export const env = loadEnv()

export type Env = z.infer<typeof envSchema>
