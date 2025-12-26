import { describe, it, expect } from 'vitest'
import * as fs from 'fs/promises'
import * as path from 'path'

describe('reminders module structure', () => {
  describe('exports', () => {
    it('exports all public functions from index', async () => {
      const reminders = await import('../../../src/jobs/reminders/index.js')

      // Core exports
      expect(reminders.scheduleReminder).toBeDefined()
      expect(reminders.cancelReminder).toBeDefined()
      expect(reminders.cancelAllRemindersForEntity).toBeDefined()
      expect(reminders.isRequestValidForReminder).toBeDefined()
      expect(reminders.getBestChannel).toBeDefined()

      // Request exports
      expect(reminders.scheduleRequestReminders).toBeDefined()
      expect(reminders.scheduleRequestUnpaidReminder).toBeDefined()

      // Engagement exports
      expect(reminders.scheduleOnboardingReminders).toBeDefined()
      expect(reminders.cancelOnboardingReminders).toBeDefined()
      expect(reminders.scheduleNoSubscribersReminder).toBeDefined()

      // Subscription exports
      expect(reminders.scheduleSubscriptionRenewalReminders).toBeDefined()
      expect(reminders.schedulePaymentFailedReminder).toBeDefined()
      expect(reminders.schedulePastDueReminder).toBeDefined()
      expect(reminders.cancelSubscriptionReminders).toBeDefined()

      // Processor exports
      expect(reminders.processDueReminders).toBeDefined()

      // Recovery exports
      expect(reminders.scanAndScheduleMissedReminders).toBeDefined()
    })

    it('exports type definitions', async () => {
      const types = await import('../../../src/jobs/reminders/types.js')

      // Type exports
      expect(types.SMS_ELIGIBLE_TYPES).toBeDefined()
      expect(Array.isArray(types.SMS_ELIGIBLE_TYPES)).toBe(true)
    })
  })

  describe('module file sizes', () => {
    const baseDir = path.join(process.cwd(), 'src/jobs/reminders')
    // Max 400 lines per module (~4x reduction from 1,638 line original)
    const MAX_LINES = 400

    const moduleFiles = [
      'core.ts',
      'request.ts',
      'engagement.ts',
      'subscription.ts',
      'recovery.ts',
      'processor/index.ts',
      'processor/request.ts',
      'processor/engagement.ts',
      'processor/subscription.ts',
    ]

    for (const file of moduleFiles) {
      it(`${file} is under ${MAX_LINES} lines`, async () => {
        const filePath = path.join(baseDir, file)
        const content = await fs.readFile(filePath, 'utf-8')
        const lines = content.split('\n').length
        expect(lines, `${file} has ${lines} lines`).toBeLessThan(MAX_LINES)
      })
    }
  })

  describe('backwards compatibility', () => {
    it('legacy import path still works', async () => {
      // The old reminders.ts should re-export everything
      const legacy = await import('../../../src/jobs/reminders.js')

      expect(legacy.scheduleReminder).toBeDefined()
      expect(legacy.processDueReminders).toBeDefined()
      expect(legacy.scheduleRequestReminders).toBeDefined()
      expect(legacy.scheduleSubscriptionRenewalReminders).toBeDefined()
      expect(legacy.scanAndScheduleMissedReminders).toBeDefined()

      // Default export should also work
      expect(legacy.default).toBeDefined()
      expect(legacy.default.processDueReminders).toBeDefined()
    })
  })
})
