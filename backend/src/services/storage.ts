import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { nanoid } from 'nanoid'
import { env } from '../config/env.js'

// Cloudflare R2 client (S3-compatible)
// Disable request checksums - they cause CORS issues with R2 presigned URLs
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
  // Disable automatic checksum calculation for R2 compatibility
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

// Allowed file types
const ALLOWED_MIME_TYPES = {
  avatar: ['image/jpeg', 'image/png', 'image/webp'],
  photo: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  voice: ['audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg'],
}

// Max file sizes in bytes
const MAX_FILE_SIZES = {
  avatar: 10 * 1024 * 1024,  // 10MB - frontend compresses, but allow headroom
  photo: 15 * 1024 * 1024,   // 15MB
  voice: 10 * 1024 * 1024,   // 10MB
}

type UploadType = 'avatar' | 'photo' | 'voice'

interface SignedUploadUrl {
  uploadUrl: string
  publicUrl: string
  key: string
  expiresAt: Date
  maxBytes: number
}

// Generate signed upload URL
export async function getSignedUploadUrl(
  userId: string,
  type: UploadType,
  mimeType: string,
  fileName?: string
): Promise<SignedUploadUrl> {
  // Validate mime type
  if (!ALLOWED_MIME_TYPES[type].includes(mimeType)) {
    throw new Error(`Invalid file type. Allowed: ${ALLOWED_MIME_TYPES[type].join(', ')}`)
  }

  // Generate unique key
  const ext = mimeType.split('/')[1]
  const key = `${type}s/${userId}/${nanoid()}.${ext}`

  // Create signed URL (expires in 10 minutes)
  // Note: Don't include ChecksumAlgorithm - it causes CORS issues with R2
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    ContentType: mimeType,
  })

  // Disable checksum headers in signed URL to avoid CORS issues
  const uploadUrl = await getSignedUrl(r2, command, {
    expiresIn: 600,
    unhoistableHeaders: new Set(['x-amz-checksum-crc32']),
  })
  const expiresAt = new Date(Date.now() + 600 * 1000)
  const publicUrl = `${env.R2_PUBLIC_URL}/${key}`

  return {
    uploadUrl,
    publicUrl,
    key,
    expiresAt,
    maxBytes: MAX_FILE_SIZES[type],
  }
}

// Delete file from storage
export async function deleteFile(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
  })

  await r2.send(command)
}

// Extract key from public URL
export function getKeyFromUrl(publicUrl: string): string | null {
  if (!publicUrl.startsWith(env.R2_PUBLIC_URL)) {
    return null
  }
  return publicUrl.replace(`${env.R2_PUBLIC_URL}/`, '')
}
