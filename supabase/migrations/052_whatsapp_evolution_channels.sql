-- ============================================================
-- Suporte a WhatsApp não oficial via Evolution API (QR Code).
--
-- whatsapp_channels ganha um segundo "tipo" de canal ao lado do
-- cloud_api (Meta oficial) existente. phone_number_id e
-- access_token_encrypted continuam NOT NULL — não foram relaxados —
-- porque um canal evolution não tem um número Meta real nem um
-- access_token de verdade:
--   - phone_number_id recebe o próprio evolution_instance_name
--     (já é único por conta, então satisfaz a UNIQUE(account_id,
--     phone_number_id) de graça — só não é usado para resolver envio/
--     recebimento em canais evolution, que resolvem por
--     evolution_instance_name).
--   - access_token_encrypted recebe encrypt(evolution_instance_name)
--     como placeholder — nunca é descriptografado para canais
--     evolution (a autenticação real com a Evolution API é via
--     EVOLUTION_API_KEY, uma única credencial de servidor
--     compartilhada por todas as instâncias).
-- Ver src/lib/whatsapp/channels.ts e
-- src/app/api/whatsapp/channels/evolution/route.ts.
-- ============================================================

ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS channel_type text NOT NULL DEFAULT 'cloud_api'
  CHECK (channel_type IN ('cloud_api', 'evolution'));

ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS evolution_instance_name text,
  ADD COLUMN IF NOT EXISTS evolution_status text DEFAULT 'disconnected';
