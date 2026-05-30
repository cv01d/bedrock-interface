import { Router } from "express";
import { listModels } from "../bedrock/models.js";
import { listImageModels } from "../bedrock/imageModels.js";
import { NoCredentialsError } from "../bedrock/client.js";

export const modelsRouter = Router();

modelsRouter.get("/", async (_req, res) => {
  try {
    res.json(await listModels());
  } catch (err) {
    if (err instanceof NoCredentialsError) {
      res.status(400).json({ error: err.message });
      return;
    }
    res
      .status(502)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Image-generation models the account can invoke (for the generate_image tool).
modelsRouter.get("/images", async (_req, res) => {
  try {
    res.json(await listImageModels());
  } catch (err) {
    if (err instanceof NoCredentialsError) {
      res.status(400).json({ error: err.message });
      return;
    }
    res
      .status(502)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});
