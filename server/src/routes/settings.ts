import { Router } from "express";
import { ListFoundationModelsCommand } from "@aws-sdk/client-bedrock";
import type { SettingsUpdate } from "@chat/shared";
import { getSettings, updateSettings, getAwsCredentials } from "../db/repo.js";
import { buildControlClientFrom, invalidateClients } from "../bedrock/client.js";

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  res.json(getSettings());
});

settingsRouter.put("/", async (req, res) => {
  const body = req.body as SettingsUpdate;

  // Clamp numeric ranges defensively.
  if (body.temperature !== undefined) {
    body.temperature = Math.min(Math.max(body.temperature, 0), 1);
  }
  if (body.contextSize !== undefined) {
    body.contextSize = Math.min(Math.max(Math.round(body.contextSize), 1), 200);
  }

  updateSettings(body);
  invalidateClients();

  // If credentials are now present, smoke-test them so the user gets immediate
  // feedback instead of an opaque failure on first chat.
  const creds = getAwsCredentials();
  let validation: { ok: boolean; modelCount?: number; error?: string } = {
    ok: true,
  };
  if (creds) {
    try {
      const client = buildControlClientFrom(creds);
      const out = await client.send(
        new ListFoundationModelsCommand({ byOutputModality: "TEXT" })
      );
      validation = { ok: true, modelCount: out.modelSummaries?.length ?? 0 };
    } catch (err) {
      validation = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  res.json({ settings: getSettings(), validation });
});
