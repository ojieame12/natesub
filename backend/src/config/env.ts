import { z } from 'zod'

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3001'),
  APP_URL: z.string().url(),
  API_URL: z.string().url(),

  // Database
  DATABASE_URL: z.string(),

  // Redis
  REDIS_URL: z.string(),

  // Auth
  JWT_SECRET: z.string().min(32),
  MAGIC_LINK_SECRET: z.string().min(32),
  SESSION_SECRET: z.string().min(32),
  MAGIC_LINK_EXPIRES_MINUTES: z.string().default('15'),

  // Stripe
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  STRIPE_ONBOARDING_RETURN_URL: z.string().url(),
  STRIPE_ONBOARDING_REFRESH_URL: z.string().url(),

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

  // Cloudflare R2 Storage
  R2_ACCOUNT_ID: z.string(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET: z.string(),
  R2_PUBLIC_URL: z.string().url(),

  // Feature flags
  ENABLE_PAYSTACK: z.string().transform(v => v === 'true').default('false'),
  ENABLE_FLUTTERWAVE: z.string().transform(v => v === 'true').default('false'),
  ENABLE_SMS: z.string().transform(v => v === 'true').default('false'),

  // AI Services
  GOOGLE_AI_API_KEY: z.string().optional(),     // Gemini 3 Pro - voice + content generation
  PERPLEXITY_API_KEY: z.string().optional(),    // Sonar Pro - market research
  REPLICATE_API_TOKEN: z.string().optional(),   // Recraft V3 - logo generation

  // Jobs/Scheduler
  JOBS_API_KEY: z.string().min(16).optional(),  // API key for job endpoints (cron)
})

function loadEnv() {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:')
    console.error(parsed.error.flatten().fieldErrors)
    process.exit(1)
  }

  return parsed.data
}

export const env = loadEnv()

export type Env = z.infer<typeof envSchema>
