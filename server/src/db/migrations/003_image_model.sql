-- Default image-generation model for the generate_image tool. Empty disables it.
ALTER TABLE settings ADD COLUMN default_image_model_id TEXT NOT NULL DEFAULT '';
