-- ============================================================
-- 112_pipeline_stage_marks_won.sql
--
-- A deal's status (open/won/lost) and its stage_id (the Kanban
-- column) have always been independent — nothing derived status
-- from stage, so a deal dragged into "Pago" stayed `open` until
-- someone separately clicked "Mark as won". Checked the live data
-- for account 2303e920 before building this: zero open deals
-- currently sitting in Pago/Aguardando pagamento, so no backfill is
-- needed — this migration is purely forward-looking automation.
--
-- pipeline_stages.is_won_stage: per-stage opt-in flag. When a deal's
-- stage_id changes to a stage with this flag set, apply_won_stage()
-- flips status to 'won' — deliberately one-directional (moving OUT
-- of a won stage later does NOT un-win the deal; that stays a manual
-- action via the existing lost/reopen flow).
--
-- Named "deals_apply_won_stage" so it sorts alphabetically BEFORE
-- the existing "deals_set_lost_at"/"deals_set_won_at" triggers —
-- Postgres fires same-timing (BEFORE UPDATE) row triggers in name
-- order, so by the time deals_set_won_at runs, NEW.status is already
-- 'won' and it sets won_at = now() for us; no duplicated logic. The
-- AFTER trigger deals_log_events (log_deal_event) also sees the
-- already-updated NEW.status, so the deal_events 'won' entry stays
-- accurate too. Scoped to UPDATE only, matching deals_set_won_at's
-- own scope — a deal inserted directly into a won stage (not the
-- drag-and-drop case this was asked for) is a separate, rarer path
-- left alone for now.
-- ============================================================

alter table public.pipeline_stages
  add column if not exists is_won_stage boolean not null default false;

create or replace function public.apply_won_stage()
returns trigger
language plpgsql
as $$
declare
  v_is_won boolean;
begin
  if new.stage_id is distinct from old.stage_id and new.status = 'open' then
    select is_won_stage into v_is_won from public.pipeline_stages where id = new.stage_id;
    if v_is_won then
      new.status := 'won';
    end if;
  end if;
  return new;
end;
$$;

create trigger deals_apply_won_stage
  before update on public.deals
  for each row execute function public.apply_won_stage();
