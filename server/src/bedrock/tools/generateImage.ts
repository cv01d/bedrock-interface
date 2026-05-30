import { InvokeModelCommand, type Tool } from "@aws-sdk/client-bedrock-runtime";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRuntimeClient } from "../client.js";
import { explainBedrockError } from "../errors.js";
import { adapterFor, type Aspect } from "../imageModels.js";
import { ATTACHMENTS_DIR } from "../../db/index.js";
import {
  createAttachment,
  findAttachmentByChecksum,
  getSettings,
} from "../../db/repo.js";

export const GENERATE_IMAGE_TOOL_NAME = "generate_image";

export const generateImageTool: Tool = {
  toolSpec: {
    name: GENERATE_IMAGE_TOOL_NAME,
    description:
      "Generate an image from a text description and show it to the user. " +
      "Use this whenever the user asks you to create, draw, design, render, or " +
      "generate a picture, image, logo, illustration, or artwork. The image is " +
      "rendered directly in the chat — do not attempt to describe pixels or output " +
      "base64. Provide a vivid, detailed prompt (subject, style, composition, " +
      "lighting, mood).",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "A detailed, vivid description of the image to generate. Include " +
              "subject, style, composition, lighting, and mood.",
          },
          negative_prompt: {
            type: "string",
            description:
              "Optional. Things to avoid in the image (e.g. 'blurry, text, watermark, extra fingers').",
          },
          aspect_ratio: {
            type: "string",
            enum: ["square", "portrait", "landscape"],
            description: "Optional. Image shape. Default square.",
          },
        },
        required: ["prompt"],
      },
    },
  },
};

interface GenerateImageInput {
  prompt?: string;
  negative_prompt?: string;
  aspect_ratio?: string;
}

export type GenerateImageResult =
  | { ok: true; attachmentId: number; mime: string; name: string; prompt: string }
  | { ok: false; error: string };

const ASPECTS = new Set<Aspect>(["square", "portrait", "landscape"]);

export async function runGenerateImage(
  rawInput: unknown
): Promise<GenerateImageResult> {
  const input = (rawInput ?? {}) as GenerateImageInput;
  const prompt = (input.prompt ?? "").trim();
  if (!prompt) return { ok: false, error: "No prompt was provided." };

  const modelId = getSettings().defaultImageModelId.trim();
  if (!modelId) {
    return {
      ok: false,
      error:
        "No image model is configured. Choose a default image model in Settings.",
    };
  }
  const adapter = adapterFor(modelId);
  if (!adapter) {
    return {
      ok: false,
      error: `The configured image model (${modelId}) is not supported.`,
    };
  }

  const aspect = (
    ASPECTS.has(input.aspect_ratio as Aspect) ? input.aspect_ratio : "square"
  ) as Aspect;
  const negative = (input.negative_prompt ?? "").trim();
  const seed = Math.floor(Math.random() * 2147483646);
  const body = adapter.buildBody({ prompt, negative, aspect, seed });

  try {
    const client = getRuntimeClient();
    const res = await client.send(
      new InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(body),
      })
    );

    const json = JSON.parse(new TextDecoder().decode(res.body)) as Record<
      string,
      unknown
    >;
    const b64 = adapter.parseImages(json)[0];
    if (!b64) {
      const detail = json.error ?? json.message ?? "the model returned no image.";
      return { ok: false, error: `Image generation failed: ${String(detail)}` };
    }

    const bytes = Buffer.from(b64, "base64");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const path = join(ATTACHMENTS_DIR, checksum);
    if (!existsSync(path)) writeFileSync(path, bytes);

    const name = `Generated - ${prompt.slice(0, 48)}.png`;
    const row =
      findAttachmentByChecksum(checksum) ??
      createAttachment({
        kind: "image",
        name,
        path,
        mime: "image/png",
        size: bytes.length,
        checksum,
      });

    return { ok: true, attachmentId: row.id, mime: "image/png", name: row.name, prompt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: explainBedrockError(msg) };
  }
}
