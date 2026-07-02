-- ============================================================
-- 027_deal_products_and_lost_reason.sql — Line items + loss tracking
--
-- Adds `deal_products` (line items attached to a deal — name, unit
-- value, quantity, notes) and a `lost_reason`/`lost_at` pair on
-- `deals` so agents must record why a deal was lost.
--
-- `lost_at` is maintained by a trigger rather than the application:
-- it's set the moment `status` transitions into 'lost', and cleared
-- (along with `lost_reason`) if the deal is reopened out of 'lost'.
-- Keeping this in the DB means it stays correct regardless of which
-- surface changes the status (pipelines board, deal-form, a future
-- automation action).
--
-- Written IF NOT EXISTS / idempotently: this schema was already
-- applied directly against the remote project in a prior session,
-- before this migration file existed. Re-running it locally (or on
-- a fresh environment) is safe either way.
-- ============================================================

create table if not exists public.deal_products (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  value numeric(10,2) not null default 0,
  quantity integer not null default 1,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.deal_products enable row level security;

drop policy if exists deal_products_select on public.deal_products;
create policy deal_products_select on public.deal_products
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists deal_products_insert on public.deal_products;
create policy deal_products_insert on public.deal_products
  for insert to authenticated
  with check (is_account_member(account_id));

drop policy if exists deal_products_update on public.deal_products;
create policy deal_products_update on public.deal_products
  for update to authenticated
  using (is_account_member(account_id));

drop policy if exists deal_products_delete on public.deal_products;
create policy deal_products_delete on public.deal_products
  for delete to authenticated
  using (is_account_member(account_id));

alter table public.deals
  add column if not exists lost_reason text,
  add column if not exists lost_at timestamptz;

create or replace function public.set_deal_lost_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'lost' and (old.status is distinct from 'lost') then
    new.lost_at = now();
  elsif new.status is distinct from 'lost' and old.status = 'lost' then
    new.lost_at = null;
    new.lost_reason = null;
  end if;
  return new;
end;
$$;

drop trigger if exists deals_set_lost_at on public.deals;
create trigger deals_set_lost_at
  before update on public.deals
  for each row execute function public.set_deal_lost_at();
