/**
 * One-off: encrypts a WhatsApp verify_token with the exact same
 * encrypt() used for access_token_encrypted (src/lib/whatsapp/encryption.ts),
 * so the output can be pasted straight into whatsapp_config.verify_token_encrypted
 * via SQL. Run locally so the production ENCRYPTION_KEY never has to be
 * shared outside your own .env.local.
 *
 * Usage:
 *   npx tsx scripts/encrypt-verify-token.ts "1e6d7005aefe3c1596ce6b167d6b7ee"
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { encrypt } from "../src/lib/whatsapp/encryption";

const value = process.argv[2];

if (!value) {
  console.error('Usage: npx tsx scripts/encrypt-verify-token.ts "<verify_token>"');
  process.exit(1);
}

if (!process.env.ENCRYPTION_KEY) {
  console.error("Missing ENCRYPTION_KEY — check .env.local.");
  process.exit(1);
}

console.log(encrypt(value));
