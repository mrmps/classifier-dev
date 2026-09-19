-- Which roadmap items a subscriber ticked, as ROADMAP keys (src/newsletter.ts).
-- Existing rows get an empty list: nothing is guessed about what they wanted.
-- Applied to the newsletter project by hand on 2026-09-19.
ALTER TABLE subscriber ADD COLUMN IF NOT EXISTS wants text[] NOT NULL DEFAULT '{}';
GRANT SELECT (wants), UPDATE (wants) ON subscriber TO newsletter_writer;
