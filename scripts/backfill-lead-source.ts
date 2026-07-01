/**
 * One-time backfill: apply the "Ativo" / "Receptivo" origin tag and
 * seed a starter deal for every contact that already existed before
 * the first_outbound_message trigger (and its retroactive tag/deal
 * automations) went live. New contacts going forward get the same
 * result automatically via the automation engine — this script only
 * covers the historical backlog.
 *
 * Origin per contact:
 *   - Earliest message across all of the contact's conversations is
 *     sender_type='customer' → "Receptivo" (they messaged us first)
 *   - Earliest message is sender_type='agent'                → "Ativo" (we reached out first)
 *   - No messages at all                                      → skipped, reported in the summary
 *
 * Usage:
 *   npx tsx scripts/backfill-lead-source.ts            # writes for real
 *   npx tsx scripts/backfill-lead-source.ts --dry-run   # preview only, no writes
 *
 * Safe to re-run: existing tag links and existing deals (any deal
 * already on the contact, regardless of status) are left untouched.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — check .env.local.",
  );
  process.exit(1);
}

// Service-role client — bypasses RLS so the script can walk every
// account's contacts in one pass, not just one tenant's.
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type Origin = "Ativo" | "Receptivo";

const ORIGIN_TAG_COLOR: Record<Origin, string> = {
  Ativo: "#3b82f6", // blue — matches the "New Lead" default stage color
  Receptivo: "#22c55e", // green
};

interface ContactRow {
  id: string;
  name: string | null;
  phone: string;
  account_id: string;
}

interface Summary {
  contactsProcessed: number;
  skippedNoMessages: number;
  tagsApplied: number;
  tagsAlreadyPresent: number;
  dealsCreated: number;
  dealsAlreadyExisted: number;
  dealsSkippedNoPipeline: number;
  errors: number;
}

// Per-account caches so a 10k-contact account doesn't re-fetch its
// owner/pipeline/tag rows on every single contact.
const ownerUserIdCache = new Map<string, string>();
const pipelineCache = new Map<
  string,
  { pipelineId: string; firstStageId: string } | null
>();
const tagIdCache = new Map<string, Map<Origin, string>>();

async function main() {
  const summary: Summary = {
    contactsProcessed: 0,
    skippedNoMessages: 0,
    tagsApplied: 0,
    tagsAlreadyPresent: 0,
    dealsCreated: 0,
    dealsAlreadyExisted: 0,
    dealsSkippedNoPipeline: 0,
    errors: 0,
  };

  console.log(
    `Backfill lead source — ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE — writing to the database"}`,
  );
  console.log("");

  const PAGE_SIZE = 500;
  let from = 0;
  for (;;) {
    const { data: contacts, error } = await db
      .from("contacts")
      .select("id, name, phone, account_id")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("Failed to load contacts:", error.message);
      process.exit(1);
    }
    if (!contacts || contacts.length === 0) break;

    for (const contact of contacts as ContactRow[]) {
      summary.contactsProcessed++;
      try {
        await processContact(contact, summary);
      } catch (err) {
        summary.errors++;
        console.error(
          `  ! ${label(contact)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (contacts.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  console.log("");
  console.log("Summary");
  console.log("-------");
  console.log(`Contacts processed:      ${summary.contactsProcessed}`);
  console.log(`Skipped (no messages):   ${summary.skippedNoMessages}`);
  console.log(`Tags applied:            ${summary.tagsApplied}`);
  console.log(`Tags already present:    ${summary.tagsAlreadyPresent}`);
  console.log(`Deals created:           ${summary.dealsCreated}`);
  console.log(`Deals already existed:   ${summary.dealsAlreadyExisted}`);
  console.log(`Deals skipped (no pipeline): ${summary.dealsSkippedNoPipeline}`);
  console.log(`Errors:                  ${summary.errors}`);

  if (DRY_RUN) {
    console.log("");
    console.log("Dry run — nothing was written. Re-run without --dry-run to apply.");
  }

  if (summary.errors > 0) process.exitCode = 1;
}

async function processContact(contact: ContactRow, summary: Summary): Promise<void> {
  // A contact can have more than one conversation over time (e.g. a
  // closed thread that later reopened) — look at the earliest message
  // across all of them to determine who spoke first.
  const { data: conversations, error: convError } = await db
    .from("conversations")
    .select("id")
    .eq("contact_id", contact.id);
  if (convError) throw new Error(`conversations lookup failed: ${convError.message}`);

  const conversationIds = (conversations ?? []).map((c) => c.id as string);
  if (conversationIds.length === 0) {
    summary.skippedNoMessages++;
    console.log(`  - ${label(contact)}: no conversation, skipped`);
    return;
  }

  const { data: firstMessage, error: msgError } = await db
    .from("messages")
    .select("sender_type")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (msgError) throw new Error(`messages lookup failed: ${msgError.message}`);

  if (!firstMessage) {
    summary.skippedNoMessages++;
    console.log(`  - ${label(contact)}: no messages, skipped`);
    return;
  }

  const origin: Origin = firstMessage.sender_type === "agent" ? "Ativo" : "Receptivo";

  await applyOriginTag(contact, origin, summary);
  await ensureDeal(contact, origin, summary);
}

async function applyOriginTag(
  contact: ContactRow,
  origin: Origin,
  summary: Summary,
): Promise<void> {
  const tagId = await ensureOriginTag(contact.account_id, origin);

  // In a dry run against an account whose tag doesn't exist yet,
  // ensureOriginTag returns a placeholder (nothing to look up) — treat
  // that as "not present" without hitting the DB.
  const existingLink = tagId.startsWith("dry-run-")
    ? null
    : (
        await db
          .from("contact_tags")
          .select("id")
          .eq("contact_id", contact.id)
          .eq("tag_id", tagId)
          .maybeSingle()
      ).data;

  if (existingLink) {
    summary.tagsAlreadyPresent++;
    return;
  }

  summary.tagsApplied++;
  console.log(`  + ${label(contact)}: tag "${origin}"`);
  if (DRY_RUN) return;

  const { error } = await db
    .from("contact_tags")
    .insert({ contact_id: contact.id, tag_id: tagId });
  if (error) throw new Error(`contact_tags insert failed: ${error.message}`);
}

async function ensureDeal(contact: ContactRow, origin: Origin, summary: Summary): Promise<void> {
  const { data: existingDeal, error } = await db
    .from("deals")
    .select("id")
    .eq("contact_id", contact.id)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`deals lookup failed: ${error.message}`);

  if (existingDeal) {
    summary.dealsAlreadyExisted++;
    return;
  }

  const pipeline = await getDefaultPipeline(contact.account_id);
  if (!pipeline) {
    summary.dealsSkippedNoPipeline++;
    console.log(`  ! ${label(contact)}: no pipeline in account, deal skipped`);
    return;
  }

  const title = `${contact.name || contact.phone} — Novo Lead`;
  summary.dealsCreated++;
  console.log(`  + ${label(contact)}: deal "${title}" (${origin})`);
  if (DRY_RUN) return;

  const ownerUserId = await getAccountOwnerUserId(contact.account_id);
  const { error: insertError } = await db.from("deals").insert({
    account_id: contact.account_id,
    contact_id: contact.id,
    pipeline_id: pipeline.pipelineId,
    stage_id: pipeline.firstStageId,
    title,
    value: 0,
    status: "open",
    user_id: ownerUserId,
  });
  if (insertError) throw new Error(`deals insert failed: ${insertError.message}`);
}

async function ensureOriginTag(accountId: string, origin: Origin): Promise<string> {
  let accountCache = tagIdCache.get(accountId);
  if (!accountCache) {
    accountCache = new Map();
    tagIdCache.set(accountId, accountCache);
  }
  const cached = accountCache.get(origin);
  if (cached) return cached;

  const { data: existing, error } = await db
    .from("tags")
    .select("id")
    .eq("account_id", accountId)
    .eq("name", origin)
    .maybeSingle();
  if (error) throw new Error(`tags lookup failed: ${error.message}`);

  if (existing) {
    accountCache.set(origin, existing.id);
    return existing.id;
  }

  if (DRY_RUN) {
    // Nothing to create yet — use a stable placeholder so downstream
    // membership checks in this run treat every contact as "would get
    // the tag" without ever hitting contact_tags with a fake id.
    const placeholder = `dry-run-${origin}`;
    console.log(`  + account ${accountId}: would create tag "${origin}"`);
    accountCache.set(origin, placeholder);
    return placeholder;
  }

  const ownerUserId = await getAccountOwnerUserId(accountId);
  const { data: created, error: insertError } = await db
    .from("tags")
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      name: origin,
      color: ORIGIN_TAG_COLOR[origin],
    })
    .select("id")
    .single();
  if (insertError || !created) {
    throw new Error(`Failed to create "${origin}" tag: ${insertError?.message}`);
  }

  console.log(`  + account ${accountId}: created tag "${origin}"`);
  accountCache.set(origin, created.id);
  return created.id;
}

async function getDefaultPipeline(
  accountId: string,
): Promise<{ pipelineId: string; firstStageId: string } | null> {
  if (pipelineCache.has(accountId)) return pipelineCache.get(accountId)!;

  // pipelines has no explicit ordering column — created_at (oldest
  // first) is the same "default pipeline" convention the app itself
  // uses (see src/app/(dashboard)/pipelines/page.tsx).
  const { data: pipeline, error } = await db
    .from("pipelines")
    .select("id")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`pipelines lookup failed: ${error.message}`);

  if (!pipeline) {
    pipelineCache.set(accountId, null);
    return null;
  }

  const { data: stage, error: stageError } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipeline.id)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (stageError) throw new Error(`pipeline_stages lookup failed: ${stageError.message}`);

  if (!stage) {
    pipelineCache.set(accountId, null);
    return null;
  }

  const result = { pipelineId: pipeline.id as string, firstStageId: stage.id as string };
  pipelineCache.set(accountId, result);
  return result;
}

async function getAccountOwnerUserId(accountId: string): Promise<string> {
  const cached = ownerUserIdCache.get(accountId);
  if (cached) return cached;

  const { data, error } = await db
    .from("accounts")
    .select("owner_user_id")
    .eq("id", accountId)
    .single();
  if (error || !data) {
    throw new Error(`Failed to load owner for account ${accountId}: ${error?.message}`);
  }
  ownerUserIdCache.set(accountId, data.owner_user_id as string);
  return data.owner_user_id as string;
}

function label(contact: ContactRow): string {
  return contact.name || contact.phone;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("Backfill failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
