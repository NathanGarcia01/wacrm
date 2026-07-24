-- ============================================================
-- 049_deal_loss_reasons.sql
--
-- Account-configurable list of "lost reason" quick-fill chips shown in
-- the deal-lost dialog (deal-form.tsx). Previously a fixed set of 5
-- hardcoded, translated chips (LOST_REASON_CHIPS) with no way for an
-- account to customize them. `deals.lost_reason` itself stays free
-- text — this table only backs the suggestion chips, same role the
-- old hardcoded array played.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

create table if not exists public.deal_loss_reasons (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  label text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_deal_loss_reasons_account on public.deal_loss_reasons(account_id);

-- One entry per label per account (case-insensitive) — avoids the chip
-- row growing duplicate suggestions from repeated clicks.
create unique index if not exists idx_deal_loss_reasons_account_label
  on public.deal_loss_reasons(account_id, lower(label));

alter table public.deal_loss_reasons enable row level security;

drop policy if exists deal_loss_reasons_select on public.deal_loss_reasons;
create policy deal_loss_reasons_select on public.deal_loss_reasons
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists deal_loss_reasons_insert on public.deal_loss_reasons;
create policy deal_loss_reasons_insert on public.deal_loss_reasons
  for insert to authenticated
  with check (is_account_member(account_id, 'agent'));

drop policy if exists deal_loss_reasons_update on public.deal_loss_reasons;
create policy deal_loss_reasons_update on public.deal_loss_reasons
  for update to authenticated
  using (is_account_member(account_id, 'agent'));

drop policy if exists deal_loss_reasons_delete on public.deal_loss_reasons;
create policy deal_loss_reasons_delete on public.deal_loss_reasons
  for delete to authenticated
  using (is_account_member(account_id, 'agent'));
