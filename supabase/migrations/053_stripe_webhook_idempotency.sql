-- ============================================================
-- Guarda contra processamento duplicado de eventos do Stripe.
--
-- O webhook (src/app/api/webhooks/stripe/route.ts) já faz uma
-- checagem "select antes de processar" por payload->>'stripe_event_id',
-- mas isso sozinho é uma condição de corrida: duas invocações quase
-- simultâneas do handler para o MESMO evento (confirmado em teste —
-- Next.js em dev rodou o handler duas vezes para uma única entrega do
-- Stripe) podem ambas passar pela checagem antes de qualquer uma
-- inserir. Esse índice único é o backstop de verdade: a segunda
-- tentativa de INSERT falha com unique_violation, que o webhook trata
-- como "já processado" em vez de erro.
--
-- Parcial (WHERE ... IS NOT NULL) porque toda ação disparada pelo
-- painel admin grava em subscription_events sem stripe_event_id no
-- payload — múltiplos NULLs não colidem entre si em um índice único,
-- então isso não afeta nenhuma linha fora do webhook do Stripe.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_events_stripe_event_id
  ON public.subscription_events ((payload->>'stripe_event_id'))
  WHERE payload->>'stripe_event_id' IS NOT NULL;
