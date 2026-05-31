-- Optional user-given name for a favorite. NULL falls back to the message
-- snippet for display.
ALTER TABLE favorites ADD COLUMN label TEXT;
