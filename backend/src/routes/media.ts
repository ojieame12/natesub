import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { getSignedUploadUrl } from '../services/storage.js'

const media = new Hono()

// Get signed upload URL
media.post(
  '/upload-url',
  requireAuth,
  zValidator('json', z.object({
    type: z.enum(['avatar', 'photo', 'voice']),
    mimeType: z.string(),
    fileName: z.string().optional(),
  })),
  async (c) => {
    const userId = c.get('userId')
    const { type, mimeType, fileName } = c.req.valid('json')

    try {
      const result = await getSignedUploadUrl(userId, type, mimeType, fileName)
      return c.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      return c.json({ error: message }, 400)
    }
  }
)

export default media
