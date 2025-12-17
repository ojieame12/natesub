import { Job } from 'bullmq'
import { processRecurringBilling, processRetries } from '../jobs/billing.js'

export interface BillingJobData {
  type: 'recurring' | 'retry'
}

export async function billingProcessor(job: Job<BillingJobData>) {
  const { type } = job.data
  
  console.log(`[worker] Processing billing job ${job.id} (type: ${type})`)
  
  if (type === 'recurring') {
    const result = await processRecurringBilling()
    console.log(`[worker] Billing complete: ${result.succeeded}/${result.processed} succeeded`)
    return result
  } 
  
  if (type === 'retry') {
    const result = await processRetries()
    console.log(`[worker] Retries complete: ${result.succeeded}/${result.processed} succeeded`)
    return result
  }

  throw new Error(`Unknown billing job type: ${type}`)
}
