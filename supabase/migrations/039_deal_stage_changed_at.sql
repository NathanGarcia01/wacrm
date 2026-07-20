-- "Dias na etapa" in the Google Sheets sync (037/038) needs to know when
-- a deal *entered* its current stage, which `updated_at` can't answer —
-- that column touches on every field edit, not just stage moves. Adds a
-- dedicated timestamp maintained by trigger so it only moves on an
-- actual stage_id change (or insert).
alter table public.deals
  add column if not exists stage_changed_at timestamptz not null default now();

create or replace function public.touch_deal_stage_changed_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    new.stage_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists deals_stage_changed_at on public.deals;
create trigger deals_stage_changed_at
  before insert or update on public.deals
  for each row execute function public.touch_deal_stage_changed_at();
