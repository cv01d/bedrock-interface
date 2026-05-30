import { ListFoundationModelsCommand } from "@aws-sdk/client-bedrock";
import type { ImageModelInfo } from "@chat/shared";
import { getControlClient } from "./client.js";

// Aspect → concrete dimensions. Stability XL only accepts a fixed set of
// sizes, so it gets its own pair; the newer Stability models take a ratio
// string instead of pixels.
export type Aspect = "square" | "portrait" | "landscape";

const ASPECTS: Record<
  Aspect,
  { width: number; height: number; ratio: string; sdxl: { width: number; height: number } }
> = {
  square: { width: 1024, height: 1024, ratio: "1:1", sdxl: { width: 1024, height: 1024 } },
  portrait: { width: 768, height: 1152, ratio: "9:16", sdxl: { width: 768, height: 1344 } },
  landscape: { width: 1152, height: 768, ratio: "16:9", sdxl: { width: 1344, height: 768 } },
};

export interface BuildOpts {
  prompt: string;
  negative: string;
  aspect: Aspect;
  seed: number;
}

// Each Bedrock image family has its own InvokeModel request/response shape.
// An adapter knows how to build the request body and pull base64 PNGs back out.
export interface ImageAdapter {
  buildBody(opts: BuildOpts): unknown;
  parseImages(json: unknown): string[];
}

const GEO = /^(us|eu|apac|global|us-gov)\./;
const baseId = (modelId: string) => modelId.replace(GEO, "").toLowerCase();

// Amazon Nova Canvas + Titan Image Generator share the same schema.
const amazonAdapter: ImageAdapter = {
  buildBody: ({ prompt, negative, aspect, seed }) => {
    const a = ASPECTS[aspect];
    const textToImageParams: Record<string, unknown> = { text: prompt };
    // Titan/Nova reject negativeText shorter than 3 chars.
    if (negative.length >= 3) textToImageParams.negativeText = negative;
    return {
      taskType: "TEXT_IMAGE",
      textToImageParams,
      imageGenerationConfig: {
        numberOfImages: 1,
        width: a.width,
        height: a.height,
        cfgScale: 7.0,
        seed: seed % 858993459,
      },
    };
  },
  parseImages: (json) => {
    const j = json as { images?: unknown };
    return Array.isArray(j.images) ? (j.images as string[]) : [];
  },
};

// Stability Diffusion XL (text_prompts / artifacts).
const sdxlAdapter: ImageAdapter = {
  buildBody: ({ prompt, negative, aspect, seed }) => {
    const a = ASPECTS[aspect].sdxl;
    const text_prompts: { text: string; weight: number }[] = [
      { text: prompt, weight: 1.0 },
    ];
    if (negative) text_prompts.push({ text: negative, weight: -1.0 });
    return {
      text_prompts,
      cfg_scale: 7,
      height: a.height,
      width: a.width,
      steps: 30,
      seed: seed % 4294967295,
    };
  },
  parseImages: (json) => {
    const j = json as { artifacts?: { base64?: string }[] };
    return Array.isArray(j.artifacts)
      ? j.artifacts.map((x) => x.base64 ?? "").filter(Boolean)
      : [];
  },
};

// Stability SD3 / Stable Image Core / Stable Image Ultra (prompt / aspect_ratio).
const stabilityV2Adapter: ImageAdapter = {
  buildBody: ({ prompt, negative, aspect, seed }) => {
    const body: Record<string, unknown> = {
      prompt,
      mode: "text-to-image",
      aspect_ratio: ASPECTS[aspect].ratio,
      output_format: "png",
      seed: seed % 4294967294,
    };
    if (negative) body.negative_prompt = negative;
    return body;
  },
  parseImages: (json) => {
    const j = json as { images?: unknown };
    return Array.isArray(j.images) ? (j.images as string[]) : [];
  },
};

// Returns the adapter for a model id, or null if we can't invoke it. Doubles as
// the "is this model supported?" check used when listing.
export function adapterFor(modelId: string): ImageAdapter | null {
  const id = baseId(modelId);
  if (id.includes("nova-canvas") || id.includes("titan-image")) return amazonAdapter;
  if (id.includes("stable-diffusion-xl") || id.includes("sdxl")) return sdxlAdapter;
  if (id.includes("sd3") || id.includes("stable-image")) return stabilityV2Adapter;
  return null;
}

// Lists in-region, on-demand image-generation models the account can invoke and
// for which we have a request adapter.
export async function listImageModels(): Promise<ImageModelInfo[]> {
  const client = getControlClient();
  const res = await client.send(
    new ListFoundationModelsCommand({
      byOutputModality: "IMAGE",
      byInferenceType: "ON_DEMAND",
    })
  );

  const seen = new Set<string>();
  const out: ImageModelInfo[] = [];
  for (const m of res.modelSummaries ?? []) {
    if (!m.modelId || seen.has(m.modelId)) continue;
    if (!adapterFor(m.modelId)) continue;
    seen.add(m.modelId);
    const provider = m.providerName ?? m.modelId.split(".")[0];
    out.push({
      id: m.modelId,
      label: `${m.modelName ?? m.modelId} (${provider})`,
      provider: provider.toLowerCase(),
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
