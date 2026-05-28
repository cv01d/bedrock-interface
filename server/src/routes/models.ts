import { Router } from "express";
import { listModels } from "../bedrock/models.js";
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
