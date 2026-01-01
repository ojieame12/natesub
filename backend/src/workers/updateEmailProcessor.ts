/**
 * Update Email Processor
 *
 * Handles sending update emails via the queue for reliability.
 * If the server crashes during processing, BullMQ will retry the job.
 */

import { Job } from 'bullmq'
import { db } from '../db/client.js'
import { sendUpdateEmail } from '../services/email.js'

export interface UpdateEmailJobData {
  updateId: string
  deliveryId: string
  subscriberEmail: string
  creatorName: string
  creatorUsername: string
  title: string | null
  body: string
  photoUrl: string | null
}

export async function updateEmailProcessor(job: Job<UpdateEmailJobData>) {
  const {
    updateId: _updateId,
    deliveryId,
    subscriberEmail,
    creatorName,
    creatorUsername,
    title,
    body,
    photoUrl,
  } = job.data

  console.log(`[worker] Processing update email job ${job.id} for delivery ${deliveryId}`)

  try {
    // Send the email
    const result = await sendUpdateEmail(
      subscriberEmail,
      creatorName,
      title,
      body,
      {
        photoUrl,
        creatorUsername,
        deliveryId, // For tracking pixel
      }
    )

    if (!result.success) {
      throw new Error(result.error || 'Email send failed')
    }

    // Mark delivery as sent in database
    await db.updateDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'sent',
        sentAt: new Date(),
      },
    })

    console.log(`[worker] Update email job ${job.id} completed: ${result.messageId}`)
  } catch (error: any) {
    console.error(`[worker] Update email job ${job.id} failed:`, error.message)

    // Mark delivery as failed in database
    // Use updateMany to avoid errors if the record was deleted
    await db.updateDelivery.updateMany({
      where: { id: deliveryId },
      data: {
        status: 'failed',
        error: error.message?.substring(0, 500) || 'Unknown error',
      },
    })

    // Re-throw to let BullMQ handle retries
    throw error
  }
}
