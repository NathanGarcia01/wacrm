import { Resend } from "resend";

let _client: Resend | null = null;

/**
 * Lazy Resend client — mirrors the lazy service-role Supabase client
 * pattern used elsewhere (see src/lib/automations/admin-client.ts).
 * Returns null when RESEND_API_KEY isn't configured so callers can
 * treat "email sending disabled" as a normal, non-throwing case
 * (transactional email should never be a hard dependency for signup).
 */
export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!_client) _client = new Resend(apiKey);
  return _client;
}

/**
 * `www.funilly.tech` needs its DNS records (SPF/DKIM) verified in the
 * Resend dashboard before Resend will send from a `@www.funilly.tech`
 * address — an unverified sending domain makes Resend reject the send
 * outright. Until an operator sets RESEND_FROM_EMAIL to a verified
 * sender, fall back to Resend's own shared sandbox address so
 * transactional email still goes out instead of failing outright.
 *
 * Note: a Resend account with no verified domain at all is also
 * restricted to delivering only to the account owner's own address,
 * regardless of which "from" address is used — if welcome emails
 * aren't reaching real signups, check that first (Resend dashboard →
 * Domains) before assuming this fallback is the problem.
 *
 * TODO(ops): once www.funilly.tech is verified in Resend, set
 *   RESEND_FROM_EMAIL="Funilly <noreply@www.funilly.tech>"
 * in the deployment env (Render) and this fallback stops being used.
 */
export function getWelcomeEmailFrom(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "Funilly <onboarding@resend.dev>";
}
