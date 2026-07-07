-- ============================================================
-- 031_quick_replies_and_deal_reopen.sql
--
-- 1. Documents `quick_replies` and the `deals_set_won_at` trigger,
--    both already applied directly against the remote project in a
--    prior session (same situation as migrations 027/030) — written
--    idempotently so re-running locally or on a fresh environment is
--    safe either way.
--
-- 2. New: when a deal transitions INTO 'won' or 'lost', automatically
--    open a fresh deal for the same contact in the same pipeline's
--    first stage (position 0), with no products and no value. The
--    closed deal stays untouched as history — this just keeps the
--    relationship going instead of the pipeline going quiet the
--    moment a deal closes.
--
--    Guarded to only fire on an actual transition INTO won/lost (not
--    every update while already in that status), and skipped when the
--    deal's contact has been deleted (contact_id is nullable, ON
--    DELETE SET NULL) — nothing to continue the relationship with.
-- ============================================================

-- ---- 1. quick_replies (already live) ----------------------------

create table if not exists public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  title text not null,
  content text not null,
  shortcut text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quick_replies_account on public.quick_replies(account_id);

drop trigger if exists set_updated_at on public.quick_replies;
create trigger set_updated_at
  before update on public.quick_replies
  for each row execute function public.update_updated_at_column();

alter table public.quick_replies enable row level security;

drop policy if exists quick_replies_select on public.quick_replies;
create policy quick_replies_select on public.quick_replies
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists quick_replies_insert on public.quick_replies;
create policy quick_replies_insert on public.quick_replies
  for insert to authenticated
  with check (is_account_member(account_id, 'agent'));

drop policy if exists quick_replies_update on public.quick_replies;
create policy quick_replies_update on public.quick_replies
  for update to authenticated
  using (is_account_member(account_id, 'agent'));

drop policy if exists quick_replies_delete on public.quick_replies;
create policy quick_replies_delete on public.quick_replies
  for delete to authenticated
  using (is_account_member(account_id, 'agent'));

-- ---- 2. deals_set_won_at (already live) -------------------------

create or replace function public.set_deal_won_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'won' and (old.status is distinct from 'won') then
    new.won_at = now();
  elsif new.status is distinct from 'won' and old.status = 'won' then
    new.won_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists deals_set_won_at on public.deals;
create trigger deals_set_won_at
  before update on public.deals
  for each row execute function public.set_deal_won_at();

-- ---- 3. New: reopen the relationship on close (new) -------------

create or replace function public.create_deal_on_close()
returns trigger language plpgsql as $$
declare
  v_first_stage uuid;
begin
  if new.status not in ('won', 'lost') then
    return new;
  end if;
  if old.status is not distinct from new.status then
    return new;
  end if;
  if new.contact_id is null then
    return new;
  end if;

  select id into v_first_stage
  from public.pipeline_stages
  where pipeline_id = new.pipeline_id
  order by position asc
  limit 1;

  if v_first_stage is null then
    return new;
  end if;

  insert into public.deals (
    user_id, account_id, pipeline_id, stage_id, contact_id,
    title, value, currency, status
  )
  values (
    new.user_id, new.account_id, new.pipeline_id, v_first_stage, new.contact_id,
    new.title, 0, new.currency, 'open'
  );

  return new;
end;
$$;

drop trigger if exists deals_create_on_close on public.deals;
create trigger deals_create_on_close
  after update on public.deals
  for each row execute function public.create_deal_on_close();
