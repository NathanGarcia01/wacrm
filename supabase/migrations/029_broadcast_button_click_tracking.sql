-- Tracks which template Quick Reply button a broadcast recipient tapped,
-- so reports can answer "how many clicked button A vs button B".
ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS button_clicked text,
  ADD COLUMN IF NOT EXISTS button_clicked_at timestamptz;
