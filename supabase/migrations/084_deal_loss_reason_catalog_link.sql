-- ============================================================
-- 084_deal_loss_reason_catalog_link.sql
--
-- Fase 4, Etapa 2 — liga `deals.lost_reason` (texto livre) ao
-- catálogo `deal_loss_reasons`, mantendo o texto livre como "Outro".
--
-- `deals.lost_reason_id` é NULLABLE e sem `ON DELETE` (= RESTRICT),
-- mesmo padrão já usado em `tickets.closing_reason_id`
-- (migration 070): não dá pra apagar um motivo do catálogo que algum
-- negócio ainda referencia — o relatório sempre faz left join ao
-- vivo pra pegar o label, então nunca existe "negócio com motivo
-- apagado" pra tratar.
--
-- `deals.lost_reason` (texto) é MANTIDA e continua sendo preenchida
-- mesmo quando `lost_reason_id` é setado — o novo texto escolhido no
-- chip do catálogo é espelhado pra lá também. Isso significa que
-- TODO leitor existente (export CSV, export Google Sheets, exibição
-- no card do negócio) continua funcionando sem precisar ser tocado;
-- só o `get_pipeline_dashboard()` (migration 083) e o
-- `loadLossesReport` (Pipeline → Perdas, fora de Reports) precisam
-- aprender a preferir o id quando ele existir.
--
-- `deal_loss_reasons.is_active`: mesmo padrão de `closing_reasons`
-- (migration 069) — um motivo "inativo" para de aparecer nos chips
-- novos mas continua servindo o join histórico dos negócios que já
-- apontam pra ele.
--
-- RLS de `deal_loss_reasons` apertada pra admin (migration 049
-- liberava insert/update/delete pra qualquer 'agent' — inconsistente
-- com `closing_reasons`, que já era admin-only; agora que o catálogo
-- também sustenta relatório, faz sentido o mesmo nível de proteção).
--
-- Backfill: negócios antigos (`status = 'lost'`) cujo
-- `lower(trim(lost_reason))` bate EXATAMENTE com
-- `lower(trim(label))` de uma linha do catálogo da mesma conta
-- ganham `lost_reason_id` retroativamente — mesma regra de
-- normalização que `get_pipeline_dashboard()` já usa pra agrupar
-- (076/083), então o que já casava visualmente nos relatórios passa
-- a casar de verdade no dado. Tudo que não bate (erro de digitação,
-- motivo sem chip correspondente) continua como texto livre, sem
-- nenhuma tentativa de match aproximado.
-- ============================================================

alter table public.deal_loss_reasons
  add column if not exists is_active boolean not null default true;

drop policy if exists deal_loss_reasons_insert on public.deal_loss_reasons;
create policy deal_loss_reasons_insert on public.deal_loss_reasons
  for insert to authenticated
  with check (is_account_member(account_id, 'admin'));

drop policy if exists deal_loss_reasons_update on public.deal_loss_reasons;
create policy deal_loss_reasons_update on public.deal_loss_reasons
  for update to authenticated
  using (is_account_member(account_id, 'admin'));

drop policy if exists deal_loss_reasons_delete on public.deal_loss_reasons;
create policy deal_loss_reasons_delete on public.deal_loss_reasons
  for delete to authenticated
  using (is_account_member(account_id, 'admin'));

alter table public.deals
  add column if not exists lost_reason_id uuid references public.deal_loss_reasons(id);

create index if not exists idx_deals_lost_reason_id on public.deals(lost_reason_id);

update public.deals d
set lost_reason_id = r.id
from public.deal_loss_reasons r
where d.account_id = r.account_id
  and d.status = 'lost'
  and d.lost_reason_id is null
  and d.lost_reason is not null
  and lower(trim(d.lost_reason)) = lower(trim(r.label));
