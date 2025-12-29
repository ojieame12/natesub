import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { mediaUploadRateLimit } from '../middleware/rateLimit.js'
import { getSignedUploadUrl } from '../services/storage.js'

const media = new Hono()

// Get signed upload URL
// SECURITY: fileSize is required and enforced server-side via Content-Length in signed URL
media.post(
  '/upload-url',
  requireAuth,
  mediaUploadRateLimit,
  zValidator('json', z.object({
    type: z.enum(['avatar', 'photo', 'voice', 'banner']),
    mimeType: z.string(),
    fileSize: z.number().int().positive().max(50 * 1024 * 1024), // Max 50MB absolute limit
    fileName: z.string().optional(),
  })),
  async (c) => {
    const userId = c.get('userId')
    const { type, mimeType, fileSize, fileName } = c.req.valid('json')

    try {
      const result = await getSignedUploadUrl(userId, type, mimeType, fileSize, fileName)
      return c.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      return c.json({ error: message }, 400)
    }
  }
)

export default media
