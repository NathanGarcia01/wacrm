-- ============================================================
-- 030_product_catalog_and_commission.sql
--
-- Adds:
--   1. `commission_rate` / `commission_value` on `deal_products` —
--      per-line-item commission tracking. `commission_value` is
--      maintained by the application (value * quantity *
--      commission_rate / 100), not a generated column, since the
--      formula needs to survive independent edits to any one factor
--      without recomputing the others server-side.
--   2. `product_catalog` — account-scoped pre-registered products
--      (name, default value, default commission rate, description,
--      active flag) that the deal-product picker can pull defaults
--      from instead of the agent typing them from scratch every time.
--
-- Written IF NOT EXISTS / idempotently: this schema was already
-- applied directly against the remote project in a prior session,
-- before this migration file existed (same situation as migration
-- 027 for deal_products itself). Re-running it locally or on a fresh
-- environment is safe either way.
-- ============================================================

alter table public.deal_products
  add column if not exists commission_rate numeric(6,3) default 0,
  add column if not exists commission_value numeric(12,2) default 0;

create table if not exists public.product_catalog (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  default_value numeric(12,2) not null default 0,
  default_commission_rate numeric(6,3) default 0,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_catalog_account on public.product_catalog(account_id);

drop trigger if exists set_updated_at on public.product_catalog;
create trigger set_updated_at
  before update on public.product_catalog
  for each row execute function public.update_updated_at_column();

alter table public.product_catalog enable row level security;

drop policy if exists product_catalog_select on public.product_catalog;
create policy product_catalog_select on public.product_catalog
  for select to authenticated
  using (is_account_member(account_id));

-- Creating/editing/removing catalog entries is admin+ — agents can pick
-- from the catalog when adding a deal product, but the catalog itself
-- is workspace configuration, same tier as custom fields/tags.
drop policy if exists product_catalog_insert on public.product_catalog;
create policy product_catalog_insert on public.product_catalog
  for insert to authenticated
  with check (is_account_member(account_id, 'admin'));

drop policy if exists product_catalog_update on public.product_catalog;
create policy product_catalog_update on public.product_catalog
  for update to authenticated
  using (is_account_member(account_id, 'admin'));

drop policy if exists product_catalog_delete on public.product_catalog;
create policy product_catalog_delete on public.product_catalog
  for delete to authenticated
  using (is_account_member(account_id, 'admin'));
