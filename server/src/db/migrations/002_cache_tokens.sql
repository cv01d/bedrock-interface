-- Prompt-cache token accounting. Bedrock reports cache reads/writes separately
-- from input_tokens; we store them per assistant turn to price them correctly
-- (reads are cheaper, writes carry a surcharge).

ALTER TABLE messages ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE messages ADD COLUMN cache_write_tokens INTEGER;
