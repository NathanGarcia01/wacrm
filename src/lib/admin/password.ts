import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

const SALT_BYTES = 16
const KEY_LENGTH = 64

/**
 * Admin login password hashing — Node's built-in `crypto.scrypt`
 * rather than bcrypt/argon2. No new dependency (matches the
 * codebase's existing convention of plain Node `crypto` for secrets —
 * see whatsapp/encryption.ts's AES-256-GCM), and scrypt is an
 * OWASP-acceptable slow KDF for human-chosen passwords. This is
 * deliberately NOT the same approach as api-keys/keys.ts's SHA-256:
 * that file's own comment explains SHA-256 is fine for full-entropy
 * random tokens but wrong for passwords, which need a slow KDF —
 * this is that KDF.
 *
 * Stored format: `${saltHex}:${hashHex}` — same colon-joined
 * convention as whatsapp/encryption.ts's `iv:ciphertext:authTag`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer
  return `${salt.toString('hex')}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 2) return false
  const [saltHex, hashHex] = parts
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  const derived = (await scryptAsync(password, salt, expected.length)) as Buffer
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}
