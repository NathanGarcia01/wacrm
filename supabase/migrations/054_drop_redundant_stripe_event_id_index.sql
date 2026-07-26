-- ============================================================
-- A migration 053 criou um índice único parcial em
-- payload->>'stripe_event_id' para servir de guarda de idempotência do
-- webhook do Stripe (src/app/api/webhooks/stripe/route.ts). Só depois
-- ficou claro que `subscription_events` já tinha uma coluna própria
-- `stripe_event_id` com unique constraint
-- (subscription_events_stripe_event_id_key, da migration original de
-- billing) cobrindo exatamente o mesmo caso — o índice da 053 era
-- redundante. O código agora grava/consulta a coluna real
-- (logSubscriptionEvent em src/lib/admin/log-event.ts) em vez do
-- payload JSON, então este índice nunca mais é usado.
-- ============================================================

DROP INDEX IF EXISTS public.idx_subscription_events_stripe_event_id;
