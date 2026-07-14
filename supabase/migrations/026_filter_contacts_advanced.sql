-- ============================================================
-- 026_filter_contacts_advanced.sql — server-side contacts filter
-- (tags + created-date range + assigned agent), superseding the
-- tag-only RPC from migration 025 for the Contacts page filter bar.
--
-- Why an RPC (same rationale as 025): resolving tag/agent membership
-- on the client via separate .in()/.eq() round trips hits PostgREST's
-- ~1000-row cap on the join tables and breaks pagination/total counts
-- once an account has enough contacts. One query does the joins,
-- de-duplication, ordering, windowed total count, and LIMIT/OFFSET.
--
-- Assigned agent lives on `conversations` (one per contact in this
-- inbox model), not on `contacts` itself — hence the EXISTS against
-- conversations rather than a direct column filter. p_unassigned_only
-- is a separate flag (not just "p_agent_id IS NULL") because NULL
-- already means "don't filter by agent at all".
--
-- Security: SECURITY INVOKER — runs as the caller, so RLS on
-- contacts/contact_tags/conversations (migration 017) scopes the
-- result to the caller's account, same as 025.
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
  p_offset INT DEFAULT 0
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

ALTER FUNCTION public.filter_contacts(UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts(UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts(UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN, INT, INT) TO authenticated;
