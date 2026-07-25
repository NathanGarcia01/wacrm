/**
 * One-off: encrypts a WhatsApp verify_token with the exact same
 * encrypt() used for access_token_encrypted (src/lib/whatsapp/encryption.ts),
 * so the output can be pasted straight into whatsapp_config.verify_token_encrypted
 * via SQL. Run locally so the production ENCRYPTION_KEY never has to be
 * shared outside your own .env.local.
 *
 * The import of encryption.ts is dynamic (`await import(...)`) rather than
 * a static `import` — static imports are hoisted above every other
 * statement in this file, so encryption.ts would read
 * process.env.ENCRYPTION_KEY (via its module-level `const ENCRYPTION_KEY =
 * process.env.ENCRYPTION_KEY!`) before dotenv's config() below ever runs,
 * always capturing `undefined`. The dynamic import defers loading that
 * module until after config() has populated process.env.
 *
 * Usage:
 *   npx tsx scripts/encrypt-verify-token.ts "1e6d7005aefe3c1596ce6b167d6b7ee"
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const value = process.argv[2];

  if (!value) {
    console.error('Usage: npx tsx scripts/encrypt-verify-token.ts "<verify_token>"');
    process.exit(1);
  }

  if (!process.env.ENCRYPTION_KEY) {
    console.error("Missing ENCRYPTION_KEY — check .env.local.");
    process.exit(1);
  }

  const { encrypt } = await import("../src/lib/whatsapp/encryption");
  console.log(encrypt(value));
}

main();
