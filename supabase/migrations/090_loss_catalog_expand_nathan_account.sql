-- ============================================================
-- 090_loss_catalog_expand_nathan_account.sql
--
-- Adds 7 new deal_loss_reasons entries for account
-- 2303e920-c4a9-4224-a13d-7b81e5634813 and retroactively links lost
-- deals whose free-text lost_reason matches one of the mapped
-- variants (lower(trim()) comparison, same rule as migration 084).
-- Scoped to this single account only — explicit account_id in every
-- statement, no account-wide backfill.
--
-- Mapping (several free-text variants can collapse onto one new
-- catalog label):
--   "Não sou a pessoa"            <- NÃO SOU A PESSOA
--   "Sem resposta"                <- Sem resposta
--   "Pediu para sair"             <- SAIR [Disparo]
--   "Contato errado"              <- Contato errado
--   "Reprovado"                   <- REPROVADO; REPROVADO, MARGEM NEGATIVA
--   "Tempo de casa insuficiente"  <- "Cliente Não Elegível. Trabalhador
--                                     não possui tempo de casa mínimo
--                                     aceito."; "< 3 MESES"
--   "Empresa não elegível"        <- "Operação não permitida pelo
--                                     porte da empresa :("
--
-- Verified live before/after, scoped to this account's lost deals:
--   before: linked=985, free_text=127, total=1112
--   after:  linked=1079, free_text=33, total=1112  (+94 linked)
-- The +94 matches the live per-variant breakdown taken right before
-- applying (28+16+13+12+11+4+4+3+3), not the slightly older
-- Etapa-2 top-10 snapshot — a few more deals had accumulated the
-- same free-text values since then.
--
-- Idempotent: label insert uses ON CONFLICT on the existing
-- (account_id, lower(label)) unique index (migration 049); the
-- deals UPDATE only touches rows still unlinked
-- (lost_reason_id IS NULL), so re-running is a no-op.
-- ============================================================

INSERT INTO deal_loss_reasons (account_id, label, position)
VALUES
  ('2303e920-c4a9-4224-a13d-7b81e5634813', 'Não sou a pessoa', 3),
  ('2303e920-c4a9-4224-a13d-7b81e5634813', 'Sem resposta', 4),
  ('2303e920-c4a9-4224-a13d-7b81e5634813', 'Pediu para sair', 5),
  ('2303e920-c4a9-4224-a13d-7b81e5634813', 'Contato errado', 6),
  ('2303e920-c4a9-4224-a13d-7b81e5634813', 'Reprovado', 7),
  ('2303e920-c4a9-4224-a13d-7b81e5634813', 'Tempo de casa insuficiente', 8),
  ('2303e920-c4a9-4224-a13d-7b81e5634813', 'Empresa não elegível', 9)
ON CONFLICT (account_id, lower(label)) DO NOTHING;

WITH mapping (old_text, new_label) AS (
  VALUES
    ('NÃO SOU A PESSOA', 'Não sou a pessoa'),
    ('Sem resposta', 'Sem resposta'),
    ('SAIR [Disparo]', 'Pediu para sair'),
    ('Contato errado', 'Contato errado'),
    ('REPROVADO', 'Reprovado'),
    ('REPROVADO, MARGEM NEGATIVA', 'Reprovado'),
    ('Cliente Não Elegível. Trabalhador não possui tempo de casa mínimo aceito.', 'Tempo de casa insuficiente'),
    ('< 3 MESES', 'Tempo de casa insuficiente'),
    ('Operação não permitida pelo porte da empresa :(', 'Empresa não elegível')
)
UPDATE deals d
SET lost_reason_id = r.id
FROM mapping m
JOIN deal_loss_reasons r
  ON r.account_id = '2303e920-c4a9-4224-a13d-7b81e5634813'
  AND lower(trim(r.label)) = lower(trim(m.new_label))
WHERE d.account_id = '2303e920-c4a9-4224-a13d-7b81e5634813'
  AND d.status = 'lost'
  AND d.lost_reason_id IS NULL
  AND lower(trim(d.lost_reason)) = lower(trim(m.old_text));
