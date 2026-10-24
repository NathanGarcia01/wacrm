-- O webhook de status da Meta manda `errors[]` (code/title/message/
-- error_data.details) em todo evento "failed", mas handleStatusUpdate
-- só gravava o status — nunca o motivo. Isso deixava toda falha opaca
-- (visto ao investigar 59 falhas sem nenhum error_code/error_message
-- em broadcast_recipients, apesar de a Meta ter mandado o motivo).
--
-- broadcast_recipients já tinha error_code/error_message (migration
-- 003/114) — só faltava popular. `messages` nunca teve essas colunas;
-- adicionadas aqui para cobrir falhas de envio FORA de um disparo
-- (mensagem avulsa do atendente, fluxo, automação) pelo mesmo motivo.

alter table public.messages
  add column if not exists error_code integer,
  add column if not exists error_message text;

comment on column public.messages.error_code is
  'Código numérico do erro da Meta (ex.: 131047) quando status = failed. Null para mensagens sem falha.';
comment on column public.messages.error_message is
  'Texto bruto do erro da Meta (title/message/error_data.details combinados) quando status = failed.';
