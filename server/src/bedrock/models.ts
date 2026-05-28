import {
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
  type FoundationModelSummary,
} from "@aws-sdk/client-bedrock";
import type { ModelInfo } from "@chat/shared";
import { getControlClient } from "./client.js";
import { priceFor } from "./pricing.js";

// Cross-region inference profiles are prefixed with a geo scope.
const GEO_PREFIXES = ["us.", "eu.", "apac.", "global.", "us-gov."];

// Providers/models we trust to support Converse tool use + documents. Kept
// conservative on purpose: a false negative just hides the history-search tool,
// while a false positive makes Converse throw a ValidationException.
function toolAndDocSupport(modelId: string, provider: string): boolean {
  const p = provider.toLowerCase();
  const id = modelId.toLowerCase();
  return p.includes("anthropic") || id.includes("nova");
}

function isTextOutput(m: FoundationModelSummary): boolean {
  return (m.outputModalities ?? []).includes("TEXT");
}

function hasVision(m: FoundationModelSummary): boolean {
  return (m.inputModalities ?? []).includes("IMAGE");
}

function modelIdFromArn(arn: string | undefined): string | null {
  if (!arn) return null;
  const idx = arn.indexOf("foundation-model/");
  if (idx === -1) return null;
  return arn.slice(idx + "foundation-model/".length);
}

// Strip the geo prefix from an inference-profile id to recover the base model id.
function stripGeoPrefix(id: string): string {
  for (const pre of GEO_PREFIXES) {
    if (id.startsWith(pre)) return id.slice(pre.length);
  }
  return id;
}

const NON_TEXT_RE =
  /embed|image|stable|pegasus|upscale|inpaint|outpaint|background|sketch|recolor|rerank|video|canvas|reranker/i;

export async function listModels(): Promise<ModelInfo[]> {
  const client = getControlClient();

  const [onDemandRes, allRes, profRes] = await Promise.all([
    // Authoritative list of in-region, on-demand, text models. The
    // byInferenceType filter is the reliable signal — the per-model
    // inferenceTypesSupported field is not always populated.
    client.send(
      new ListFoundationModelsCommand({
        byInferenceType: "ON_DEMAND",
        byOutputModality: "TEXT",
      })
    ),
    // Unfiltered — used only to resolve metadata for inference profiles.
    client.send(new ListFoundationModelsCommand({})),
    client
      .send(new ListInferenceProfilesCommand({ typeEquals: "SYSTEM_DEFINED" }))
      .catch(() => ({ inferenceProfileSummaries: [] })),
  ]);

  const byId = new Map<string, FoundationModelSummary>();
  for (const m of allRes.modelSummaries ?? []) {
    if (m.modelId) byId.set(m.modelId, m);
  }

  const models: ModelInfo[] = [];

  // 1) In-region, on-demand, text-output foundation models.
  for (const m of onDemandRes.modelSummaries ?? []) {
    if (!m.modelId) continue;
    const provider = m.providerName ?? m.modelId.split(".")[0];
    const label = `${m.modelName ?? m.modelId} (${provider})`;
    if (NON_TEXT_RE.test(label)) continue;
    const rate = priceFor(m.modelId);
    models.push({
      id: m.modelId,
      label,
      provider: provider.toLowerCase(),
      supportsTools: toolAndDocSupport(m.modelId, provider),
      supportsVision: hasVision(m),
      supportsDocuments: toolAndDocSupport(m.modelId, provider),
      isInferenceProfile: false,
      crossRegion: false,
      inputPer1M: rate.inputPer1M,
      outputPer1M: rate.outputPer1M,
      estimatedPrice: rate.estimated,
    });
  }

  // 2) Cross-region inference profiles — only those backed by a text model.
  for (const p of profRes.inferenceProfileSummaries ?? []) {
    const id = p.inferenceProfileId;
    if (!id) continue;
    const label = p.inferenceProfileName ?? id;
    // Drop chat-incompatible profiles (embeddings, image/video) by name, and —
    // when we can resolve the underlying model — also require text output.
    if (NON_TEXT_RE.test(label)) continue;
    const baseFromArn = modelIdFromArn(p.models?.[0]?.modelArn);
    const base =
      (baseFromArn && byId.get(baseFromArn)) || byId.get(stripGeoPrefix(id));
    if (base && !isTextOutput(base)) continue;

    const provider =
      base?.providerName ?? stripGeoPrefix(id).split(".")[0];
    const rate = priceFor(id);
    models.push({
      id,
      label,
      provider: provider.toLowerCase(),
      supportsTools: base
        ? toolAndDocSupport(base.modelId ?? id, provider)
        : provider.toLowerCase().includes("anthropic"),
      supportsVision: base ? hasVision(base) : false,
      supportsDocuments: base
        ? toolAndDocSupport(base.modelId ?? id, provider)
        : provider.toLowerCase().includes("anthropic"),
      isInferenceProfile: true,
      crossRegion: true,
      inputPer1M: rate.inputPer1M,
      outputPer1M: rate.outputPer1M,
      estimatedPrice: rate.estimated,
    });
  }

  // In-region first (most likely usable on restricted accounts), then
  // cross-region; alphabetical within each group.
  models.sort((a, b) => {
    if (a.crossRegion !== b.crossRegion) return a.crossRegion ? 1 : -1;
    return a.label.localeCompare(b.label);
  });

  return models;
}
