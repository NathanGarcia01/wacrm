// ============================================================
// Lead-source token utilities — pure, server-side, no Supabase.
//
// Mirrors src/lib/auth/invitations.ts and src/lib/api-keys/keys.ts:
// the DB stores only `lead_sources.token_hash` (SHA-256), never the
// plaintext. The token IS the sole credential for the public webhook
// (it rides in the URL path, not a header), so the same "show once,
// never persist, never resurface" contract applies — if an admin
// loses the URL, they revoke the source and create a new one.
//
// 32 bytes of CSPRNG entropy, base64url-encoded (43 chars, URL-safe,
// shorter than hex) — same sizing rationale as invite tokens and API
// keys.
// ============================================================

import { createHash, randomBytes } from 'node:crypto'

export interface GeneratedLeadToken {
  /** Plaintext token — return to the creator ONCE, never persist. */
  token: string
  /** SHA-256 hex digest. Persist this in `lead_sources.token_hash`. */
  hash: string
}

export function generateLeadSourceToken(): GeneratedLeadToken {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashLeadSourceToken(token) }
}

/**
 * Deterministic SHA-256 of a plaintext token. Used at webhook-receive
 * time to look up the matching `lead_sources` row by `token_hash`.
 */
export function hashLeadSourceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Build the public webhook URL for a token. Token rides in the path
 * (not the query) — same reasoning as `inviteUrl`: referrer-policy
 * noise and link-preview bots are less likely to leak/retrigger a
 * path segment than a query string.
 *
 * `baseUrl` must NOT have a trailing slash; a trailing slash is
 * tolerated anyway so callers can pass `NEXT_PUBLIC_APP_URL` verbatim.
 */
export function leadWebhookUrl(token: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return `${trimmed}/api/v1/webhooks/in/${token}`
}
