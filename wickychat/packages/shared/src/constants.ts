/** Vercel Functions cap request bodies at 4.5 MB, so uploads stay just under it. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024
export const EDIT_WINDOW_MS = Number.POSITIVE_INFINITY

/** File types that may be uploaded. Anything else is rejected. */
export const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'video/mp4',
  'video/webm',
])
export const PREVIEWABLE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
])

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '✅'] as const

/** Products in the WickyChat ecosystem and whether they are live in this build. */
export const PRODUCTS = [
  { key: 'chat', name: 'Chat', live: true },
  { key: 'voice', name: 'Voice', live: false },
  { key: 'meet', name: 'Meet', live: false },
] as const
