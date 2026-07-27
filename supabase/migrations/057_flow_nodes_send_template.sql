-- ============================================================
-- Adiciona 'send_template' ao CHECK de flow_nodes.node_type.
--
-- Node type novo (motor de fluxos, unificação automations→flows) —
-- envia um template Meta aprovado, equivalente ao send_template de
-- automations. Sem isso, qualquer INSERT em flow_nodes com
-- node_type='send_template' violaria a constraint (ver migration 046,
-- que já documentou esse mesmo gap ficando de fora para os ~15 node
-- types das Fases D/E1-E4 — este é o mesmo tipo de gap, um node type
-- a mais).
-- ============================================================

ALTER TABLE flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
ALTER TABLE flow_nodes ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_message',
    'send_buttons',
    'send_list',
    'send_media',
    'send_template',
    'collect_input',
    'wait',
    'condition',
    'randomizer',
    'set_tag',
    'start_flow',
    'stop_flow',
    'create_deal',
    'update_deal_stage',
    'update_deal_value',
    'mark_deal_won',
    'mark_deal_lost',
    'assign_conversation',
    'unassign_agent',
    'update_contact_field',
    'open_conversation',
    'set_conversation_pending',
    'close_conversation',
    'send_webhook',
    'handoff',
    'end'
  ));
