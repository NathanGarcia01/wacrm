-- ============================================================
-- 139_lead_sources.sql
--
-- Fase 3A — Fontes de captação (webhook de entrada).
--
-- `lead_sources` — uma fonte = uma URL pública (token imprevisível)
-- que, quando recebe um POST, cria/atualiza um contato e abre um
-- negócio numa etapa configurada. Token guardado só como hash
-- (token_hash, SHA-256) — mesmo padrão de account_invitations/
-- api_keys: o valor em texto puro é devolvido uma única vez na
-- criação (src/lib/leads/token.ts) e nunca mais persistido.
--
-- `lead_source_events` — auditoria append-only dos últimos
-- recebimentos (payload resumido, resultado, erro), pra tela de
-- Configurações mostrar "o que chegou" sem expor o payload bruto.
--
-- RLS: SELECT para qualquer membro da conta — a escrita (criar fonte,
-- revogar, registrar evento) sempre passa por supabaseAdmin() nas
-- rotas server-side (gate hasAPI + admin+ pra gestão, service-role
-- pro próprio webhook público, que não tem sessão Supabase).
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

create table if not exists public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  token_hash text not null,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  lead_origin_id uuid references public.lead_origins(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_lead_sources_token_hash on public.lead_sources(token_hash);
create index if not exists idx_lead_sources_account on public.lead_sources(account_id);

alter table public.lead_sources enable row level security;

drop policy if exists lead_sources_select on public.lead_sources;
create policy lead_sources_select on public.lead_sources
  for select to authenticated
  using (is_account_member(account_id));

-- Sem policy de insert/update/delete pra `authenticated` de propósito
-- (mesmo padrão de api_keys/radar_settings/followup_settings) — a
-- gestão (criar/desativar/revogar) só roda via supabaseAdmin() nas
-- rotas de /api/account/lead-sources, gate admin+ já aplicado ali.

create table if not exists public.lead_source_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  lead_source_id uuid not null references public.lead_sources(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  status text not null check (status in ('ok', 'error')),
  contact_outcome text check (contact_outcome in ('created', 'matched')),
  deal_outcome text check (deal_outcome in ('created', 'skipped_duplicate')),
  error_message text,
  -- Resumo, não o payload bruto — só os campos que a captura de fato
  -- leu (telefone/nome/email), truncados; nunca o corpo inteiro da
  -- requisição (pode trazer campos arbitrários do formulário de
  -- origem, PII além do necessário pra auditoria).
  payload_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_lead_source_events_source_created
  on public.lead_source_events(lead_source_id, created_at desc);
create index if not exists idx_lead_source_events_account_created
  on public.lead_source_events(account_id, created_at desc);

alter table public.lead_source_events enable row level security;

drop policy if exists lead_source_events_select on public.lead_source_events;
create policy lead_source_events_select on public.lead_source_events
  for select to authenticated
  using (is_account_member(account_id));
