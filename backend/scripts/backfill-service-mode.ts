#!/usr/bin/env npx tsx
/**
 * Backfill Script: Service Mode
 *
 * Generates perks and banners for existing service-purpose profiles
 * that don't have them yet.
 *
 * Usage:
 *   npx tsx scripts/backfill-service-mode.ts         # Dry run
 *   npx tsx scripts/backfill-service-mode.ts --run   # Actually update
 *
 * Prerequisites:
 *   - GOOGLE_AI_API_KEY must be set
 *   - DATABASE_URL must be set
 */

import { Prisma } from '@prisma/client'
import { db } from '../src/db/client.js'
import { generatePerks } from '../src/services/ai/perksGenerator.js'
import { generateBanner } from '../src/services/ai/bannerGenerator.js'

const DRY_RUN = !process.argv.includes('--run')

async function main() {
  console.log('='.repeat(60))
  console.log('Service Mode Backfill Script')
  console.log('='.repeat(60))
  console.log('')

  if (DRY_RUN) {
    console.log('MODE: Dry run (use --run to actually update)')
  } else {
    console.log('MODE: Live run - will update database')
  }
  console.log('')

  // Find service profiles that need perks or banner
  const profiles = await db.profile.findMany({
    where: {
      purpose: 'service',
      OR: [
        { perks: null },
        { perks: { equals: [] } },
        { bannerUrl: null },
      ],
    },
    select: {
      id: true,
      userId: true,
      username: true,
      displayName: true,
      bio: true,
      avatarUrl: true,
      bannerUrl: true,
      perks: true,
      singleAmount: true,
    },
  })

  console.log(`Found ${profiles.length} service profiles needing updates`)
  console.log('')

  let perksGenerated = 0
  let bannersGenerated = 0
  const errors: string[] = []

  for (const profile of profiles) {
    console.log(`\n--- Processing: @${profile.username} (${profile.displayName}) ---`)

    const needsPerks = !profile.perks || (Array.isArray(profile.perks) && profile.perks.length === 0)
    const needsBanner = !profile.bannerUrl && profile.avatarUrl

    if (needsPerks) {
      console.log('  [PERKS] Generating...')
      try {
        if (!profile.bio) {
          console.log('  [PERKS] Skipped - no bio/service description')
        } else {
          const perks = await generatePerks({
            serviceDescription: profile.bio,
            pricePerMonth: profile.singleAmount || 50,
            displayName: profile.displayName || undefined,
          })

          console.log(`  [PERKS] Generated: ${perks.map(p => p.title).join(', ')}`)

          if (!DRY_RUN) {
            await db.profile.update({
              where: { id: profile.id },
              data: { perks: perks as Prisma.InputJsonValue },
            })
            console.log('  [PERKS] Saved to database')
          }
          perksGenerated++
        }
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error('Unknown error')
        const msg = `Perks error for @${profile.username}: ${err.message}`
        console.error(`  [PERKS] Error: ${err.message}`)
        errors.push(msg)
      }
    }

    if (needsBanner) {
      console.log('  [BANNER] Generating...')
      try {
        const result = await generateBanner({
          avatarUrl: profile.avatarUrl!,
          userId: profile.userId,
          displayName: profile.displayName || undefined,
        })

        if (result.wasGenerated) {
          console.log(`  [BANNER] Generated: ${result.bannerUrl}`)
        } else {
          console.log('  [BANNER] Using avatar as fallback')
        }

        if (!DRY_RUN && result.wasGenerated) {
          await db.profile.update({
            where: { id: profile.id },
            data: { bannerUrl: result.bannerUrl },
          })
          console.log('  [BANNER] Saved to database')
        }
        bannersGenerated++
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error('Unknown error')
        const msg = `Banner error for @${profile.username}: ${err.message}`
        console.error(`  [BANNER] Error: ${err.message}`)
        errors.push(msg)
      }
    }

    // Rate limiting - avoid hammering the AI API
    await new Promise(r => setTimeout(r, 1000))
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('Summary')
  console.log('='.repeat(60))
  console.log(`Profiles processed: ${profiles.length}`)
  console.log(`Perks generated: ${perksGenerated}`)
  console.log(`Banners generated: ${bannersGenerated}`)
  console.log(`Errors: ${errors.length}`)

  if (errors.length > 0) {
    console.log('\nErrors:')
    errors.forEach(e => console.log(`  - ${e}`))
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes were made. Use --run to apply changes.')
  }

  await db.$disconnect()
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
