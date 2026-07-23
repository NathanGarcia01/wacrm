-- ============================================================
-- Fase B da unificação automations → flows: renomeia o trigger_type
-- 'keyword' de flows para 'keyword_match', igualando o nome que
-- automations já usa. Motivo: a partir da Fase C, flows.trigger_type
-- passa a aceitar o vocabulário inteiro de automations — manter dois
-- nomes diferentes pro mesmo conceito ('keyword' vs 'keyword_match')
-- seria uma inconsistência permanente sem necessidade.
--
-- migration 042 já ampliou o CHECK pra aceitar os dois valores
-- simultaneamente, então este UPDATE não quebra o constraint no meio
-- do caminho. Depois deste UPDATE, nada no código volta a escrever
-- 'keyword' (só 'keyword_match') — o valor antigo fica aceito no
-- CHECK só por precaução, sem uso ativo.
--
-- Idempotente — o UPDATE é um no-op se já não houver linhas com
-- trigger_type='keyword'.
-- ============================================================

UPDATE flows SET trigger_type = 'keyword_match' WHERE trigger_type = 'keyword';
