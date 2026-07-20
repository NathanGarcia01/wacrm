import crypto from 'crypto'

/**
 * Integration credential encryption (OAuth tokens, etc.) — AES-256-GCM,
 * same scheme as src/lib/whatsapp/encryption.ts but kept separate since
 * this table has no legacy CBC rows to stay compatible with.
 *
 * Format: `<iv-hex>:<ciphertext-hex>:<authTag-hex>`
 */

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!
const GCM_IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(GCM_IV_LENGTH)
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(ENCRYPTION_KEY, 'hex'),
    iv,
  )
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`
}

export function decrypt(encryptedText: string): string {
  const [ivHex, ctHex, tagHex] = encryptedText.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  if (iv.length !== GCM_IV_LENGTH) {
    throw new Error(`Encrypted value has unexpected IV length ${iv.length}`)
  }
  const authTag = Buffer.from(tagHex, 'hex')
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Encrypted value has unexpected auth-tag length ${authTag.length}`)
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(ENCRYPTION_KEY, 'hex'),
    iv,
  )
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(ctHex, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
