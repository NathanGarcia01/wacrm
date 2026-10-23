-- Caixa de entrada redesign (A+C), Parte 2 — notas internas: um balão
-- amarelo dentro da conversa, nunca enviado ao cliente (não toca a
-- tabela `messages`, que é o que de fato sai pelo WhatsApp). Append-only
-- (sem policy de update/delete), mesmo padrão de ticket_events.

create table if not exists public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  -- Bare uuid, sem FK — mesmo padrão de conversations.assigned_agent_id/
  -- tickets.assigned_agent_id: referencia profiles.user_id por
  -- convenção, não por constraint.
  author_id uuid not null,
  body text not null check (char_length(body) > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_conversation_notes_conversation
  on public.conversation_notes(conversation_id, created_at);
create index if not exists idx_conversation_notes_account
  on public.conversation_notes(account_id);

alter table public.conversation_notes enable row level security;

drop policy if exists conversation_notes_select on public.conversation_notes;
create policy conversation_notes_select on public.conversation_notes
  for select to authenticated
  using (is_account_member(account_id));

drop policy if exists conversation_notes_insert on public.conversation_notes;
create policy conversation_notes_insert on public.conversation_notes
  for insert to authenticated
  with check (is_account_member(account_id, 'agent') and author_id = auth.uid());

-- Sem policy de update/delete — notas internas são histórico de
-- atendimento, mesmo raciocínio de ticket_events (migration 070).
