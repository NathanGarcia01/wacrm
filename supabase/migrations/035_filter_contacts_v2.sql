-- ============================================================
-- 035_filter_contacts_v2.sql — extends filter_contacts (026) with
-- last-message-date, origin (Ativo/Receptivo tag), deal status, and
-- city/state (custom fields) filters for the Contacts page filter bar.
--
-- New parameters are appended after the existing p_offset so the
-- positions/types of all pre-existing parameters are unchanged —
-- CREATE OR REPLACE FUNCTION then replaces the function in place
-- (same identity) instead of creating a second overload. Callers use
-- named-parameter RPC calls (supabase.rpc('filter_contacts', {...})),
-- so argument order never mattered for them either way.
--
-- p_last_message_from/to: filters on conversations.last_message_at
-- (assigned_agent_id's sibling column — see 026's comment on why
-- assignment lives on conversations, not contacts).
--
-- p_origin ('ativo' | 'receptivo' | 'none'): origin is not a column,
-- it's a plain tag applied by the WhatsApp webhook / broadcast cron
-- (see src/lib/contacts/auto-tag.ts) — 'none' means neither tag is
-- present.
--
-- p_deal_status ('open' | 'won' | 'lost' | 'none'): EXISTS against
-- deals.status; 'none' means the contact has zero deals.
--
-- p_city / p_state: free-text match against contact_custom_values,
-- resolved through custom_fields.field_name since city/state aren't
-- fixed columns — they're whatever custom field an account created
-- (see CustomFieldsManager). Matches common PT/EN field-name variants.
--
-- Security: SECURITY INVOKER, unchanged — RLS on contacts/tags/deals/
-- conversations/contact_custom_values (migration 017) still scopes
-- every EXISTS clause to the caller's account.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.filter_contacts(
  p_tag_ids UUID[] DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_created_from TIMESTAMPTZ DEFAULT NULL,
  p_created_to TIMESTAMPTZ DEFAULT NULL,
  p_agent_id UUID DEFAULT NULL,
  p_unassigned_only BOOLEAN DEFAULT FALSE,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0,
  p_last_message_from TIMESTAMPTZ DEFAULT NULL,
  p_last_message_to TIMESTAMPTZ DEFAULT NULL,
  p_origin TEXT DEFAULT NULL,
  p_deal_status TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    WHERE (
        p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL
        OR EXISTS (
          SELECT 1 FROM contact_tags ct
          WHERE ct.contact_id = c.id AND ct.tag_id = ANY(p_tag_ids)
        )
      )
      AND (
        (p_agent_id IS NULL AND NOT p_unassigned_only)
        OR EXISTS (
          SELECT 1 FROM conversations cv
          WHERE cv.contact_id = c.id
            AND (
              (p_unassigned_only AND cv.assigned_agent_id IS NULL)
              OR (p_agent_id IS NOT NULL AND cv.assigned_agent_id = p_agent_id)
            )
        )
      )
      AND (p_created_from IS NULL OR c.created_at >= p_created_from)
      AND (p_created_to IS NULL OR c.created_at < p_created_to)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
      AND (
        (p_last_message_from IS NULL AND p_last_message_to IS NULL)
        OR EXISTS (
          SELECT 1 FROM conversations cv
          WHERE cv.contact_id = c.id
            AND (p_last_message_from IS NULL OR cv.last_message_at >= p_last_message_from)
            AND (p_last_message_to IS NULL OR cv.last_message_at < p_last_message_to)
        )
      )
      AND (
        p_origin IS NULL
        OR (
          p_origin IN ('ativo', 'receptivo')
          AND EXISTS (
            SELECT 1 FROM contact_tags ct2
            JOIN tags tg ON tg.id = ct2.tag_id
            WHERE ct2.contact_id = c.id
              AND (
                (p_origin = 'ativo' AND tg.name ILIKE 'ativo')
                OR (p_origin = 'receptivo' AND tg.name ILIKE 'receptivo')
              )
          )
        )
        OR (
          p_origin = 'none'
          AND NOT EXISTS (
            SELECT 1 FROM contact_tags ct2
            JOIN tags tg ON tg.id = ct2.tag_id
            WHERE ct2.contact_id = c.id
              AND tg.name ILIKE ANY(ARRAY['ativo', 'receptivo'])
          )
        )
      )
      AND (
        p_deal_status IS NULL
        OR (p_deal_status = 'open' AND EXISTS (
              SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.status = 'open'
            ))
        OR (p_deal_status = 'won' AND EXISTS (
              SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.status = 'won'
            ))
        OR (p_deal_status = 'lost' AND EXISTS (
              SELECT 1 FROM deals d WHERE d.contact_id = c.id AND d.status = 'lost'
            ))
        OR (p_deal_status = 'none' AND NOT EXISTS (
              SELECT 1 FROM deals d WHERE d.contact_id = c.id
            ))
      )
      AND (
        p_city IS NULL
        OR EXISTS (
          SELECT 1 FROM contact_custom_values ccv
          JOIN custom_fields cf ON cf.id = ccv.custom_field_id
          WHERE ccv.contact_id = c.id
            AND cf.field_name ILIKE ANY(ARRAY['cidade', 'city'])
            AND ccv.value ILIKE '%' || p_city || '%'
        )
      )
      AND (
        p_state IS NULL
        OR EXISTS (
          SELECT 1 FROM contact_custom_values ccv
          JOIN custom_fields cf ON cf.id = ccv.custom_field_id
          WHERE ccv.contact_id = c.id
            AND cf.field_name ILIKE ANY(ARRAY['estado', 'uf', 'state'])
            AND ccv.value ILIKE '%' || p_state || '%'
        )
      )
  ),
  page AS (
    -- count(*) OVER() is evaluated before LIMIT, so it is the full
    -- match total regardless of the page being returned.
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts(
  UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, INT, INT,
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts(
  UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, INT, INT,
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts(
  UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, INT, INT,
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
