-- Proteção pedida após a investigação dos 11 negócios presos ao
-- contato de teste "NATHAN GARCIA" (telefone 5511947821438): hoje
-- nenhum desses negócios está sendo atribuído a nenhuma campanha no
-- relatório de Transmissões (o contato nunca recebeu um disparo —
-- broadcast_recipients vazio para ele), mas não havia nenhum
-- mecanismo que impedisse isso de acontecer se esse contato (ou
-- outro contato interno/de teste) algum dia receber um disparo de
-- verdade. `is_internal` marca contatos que nunca devem contar como
-- cliente real em relatórios de atribuição/receita.

alter table public.contacts
  add column if not exists is_internal boolean not null default false;

comment on column public.contacts.is_internal is
  'Contato interno/de teste (ex.: número do próprio time usado para testar fluxos/disparos). Nunca deve entrar em relatórios de atribuição de receita (ver src/lib/broadcasts/attribution.ts).';

-- Os dois contatos "Nathan Garcia" usados para teste nas duas contas
-- onde a equipe testa a Caixa de Entrada — achados durante a
-- investigação dos negócios órfãos (telefone 5511947821438 em ambas).
update public.contacts
set is_internal = true
where id in (
  '4016c229-5584-4d37-9172-22cc0b3c4cdd', -- account dea0eb2f, "Nathan Garcia"
  '4c9e5950-8e7c-4c6e-a1a8-11954ce85352'  -- account 2303e920, "NATHAN GARCIA" (dono dos 11 negócios órfãos)
);
