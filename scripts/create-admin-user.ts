/**
 * One-off: creates a row in `admin_users` so someone can log into
 * /admin with email+password. Run this once per person (yourself as
 * 'owner', a partner as 'viewer') after applying migration 041 and
 * before deploying the multi-admin login code — otherwise nobody can
 * log in at all once the old ADMIN_SECRET password stops working.
 *
 * Password is read interactively (masked) rather than as a CLI flag
 * so it never ends up in shell history.
 *
 * Usage:
 *   npx tsx scripts/create-admin-user.ts --email you@funilly.tech --name "Nathan" --role owner
 *   npx tsx scripts/create-admin-user.ts --email socio@funilly.tech --name "Sócio" --role viewer
 *
 * No `@/lib/*` imports — mirrors scripts/backfill-lead-source.ts's
 * existing convention of standalone scripts with no path-alias
 * resolution. The hashing logic below is a duplicate of
 * src/lib/admin/password.ts's hashPassword(); that file is the
 * source of truth if the two ever need to change together.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import * as readline from "node:readline";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

function parseArgs(): { email?: string; name?: string; role?: string } {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function promptHiddenPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Mute echoed characters so the password isn't visible on screen —
    // a "muted" _writeToOutput is the standard Node trick for this
    // without pulling in a dependency for masked prompts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rlAny = rl as any;
    let muted = false;
    rlAny._writeToOutput = (line: string) => {
      if (!muted) rlAny.output.write(line);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const { email, name, role = "viewer" } = parseArgs();

  if (!email || !name) {
    console.error("Usage: npx tsx scripts/create-admin-user.ts --email <email> --name <name> --role <owner|viewer>");
    process.exit(1);
  }
  if (role !== "owner" && role !== "viewer") {
    console.error(`Invalid --role "${role}" — must be "owner" or "viewer".`);
    process.exit(1);
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — check .env.local.");
    process.exit(1);
  }

  // Printed BEFORE the password prompt so it's obvious which project
  // is about to receive it — confirm this matches your production
  // Supabase project before typing anything.
  console.log(`Conectando em: ${SUPABASE_URL}`);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Fail fast if migration 041_admin_users.sql hasn't been applied
  // yet, instead of prompting for a password and only discovering the
  // table doesn't exist afterward.
  const { error: probeError } = await admin.from("admin_users").select("id", { count: "exact", head: true });
  if (probeError) {
    console.error(
      `Não foi possível ler a tabela admin_users (${probeError.message}). ` +
        "Aplique supabase/migrations/041_admin_users.sql nesse projeto antes de continuar.",
    );
    process.exit(1);
  }

  const password = await promptHiddenPassword(`Senha para ${email}: `);
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }
  const confirm = await promptHiddenPassword("Confirme a senha: ");
  if (password !== confirm) {
    console.error("Passwords don't match.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  const { data, error } = await admin
    .from("admin_users")
    .upsert(
      { email: email.toLowerCase(), name, password_hash: passwordHash, role, is_active: true },
      { onConflict: "email" },
    )
    .select("id, email, name, role")
    .single();

  if (error) {
    console.error("Failed to create admin user:", error.message);
    process.exit(1);
  }

  // Re-fetch in a separate request (not just trusting the upsert's own
  // return value) — proves the row is actually readable back from the
  // same project, not just that the request object looked right.
  const { data: verify, error: verifyError } = await admin
    .from("admin_users")
    .select("id, email, name, role")
    .eq("id", data.id)
    .maybeSingle();

  console.log("\n================ SUCCESS ================");
  console.log("Admin user row (from upsert):", data);
  console.log("Admin user row (re-fetched)  :", verifyError ? `ERROR: ${verifyError.message}` : verify);
  console.log("===========================================\n");
}

main();
