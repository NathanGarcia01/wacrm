-- ============================================================
-- 048_messages_contacts_type.sql
--
-- Widens `messages.content_type` CHECK to allow 'contacts' — a
-- customer sharing a WhatsApp contact card. Previously fell through
-- parseMessageContent's default branch and got stored/rendered as
-- "[Unsupported message type: contacts]".
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'contacts'
  ));
