/**
 * Whole days remaining until `trialEnd`, or null when there's no trial
 * end date at all. Can be 0 or negative once a trial has lapsed but
 * the subscription hasn't transitioned status yet.
 *
 * Deliberately a separate copy of `lib/admin/trial.ts`'s identical
 * function rather than a shared import — that module lives under
 * `lib/admin` (service-role, admin-panel-only context) and this one is
 * imported from the regular authenticated app, so keeping them apart
 * avoids an app-facing bundle ever pulling in admin-only code paths.
 */
export function trialDaysRemaining(trialEnd: string | null): number | null {
  if (!trialEnd) return null;
  const diffMs = new Date(trialEnd).getTime() - Date.now();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}
