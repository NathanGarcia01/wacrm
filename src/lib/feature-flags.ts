/**
 * Simple on/off switches for UI surfaces the product wants hidden for
 * now without touching schema/data/logic underneath — flip back to
 * `true` to bring a surface back, nothing else to undo.
 */

/**
 * "Status do cliente" and "Origem do lead (manual)" — the two manual
 * catalogs from migration 086 — plus the "Origem do Contato" automatic
 * ad-referral display block in the inbox sidebar. Hides:
 *   - The three blocks in the inbox contact sidebar.
 *   - The status/lead-origin rows in the deal detail panel.
 *   - Configurações → Cadastros → "Status do cliente" / "Origens do lead".
 *   - The two filters on the Contacts list.
 *
 * Does NOT touch: the ad-referral webhook capture itself
 * (captureAdReferral, migrations 067/068 — contacts.ad_source_id etc.
 * keep getting written), nor any report reading contact_statuses /
 * lead_origins / the ad_* columns. Tables, columns, and all existing
 * data are untouched — this is a pure UI toggle.
 */
export const CONTACT_STATUS_LEAD_ORIGIN_UI_ENABLED = false;
