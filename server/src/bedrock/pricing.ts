// On-demand Bedrock pricing, USD per 1M tokens. Claude and Nova rates are the
// published on-demand rates; other providers are rough estimates flagged with
// `estimated: true`. Rates can change — update here if AWS adjusts them.

export interface Rate {
  inputPer1M: number;
  outputPer1M: number;
  estimated: boolean;
}

const GEO = /^(us|eu|apac|global|us-gov)\./;

function base(modelId: string): string {
  return modelId.replace(GEO, "").toLowerCase();
}

export function priceFor(modelId: string): Rate {
  const id = base(modelId);

  // --- Anthropic Claude (published, stable) ---
  if (id.includes("anthropic") || id.includes("claude")) {
    if (id.includes("opus")) return { inputPer1M: 15, outputPer1M: 75, estimated: false };
    if (id.includes("sonnet")) return { inputPer1M: 3, outputPer1M: 15, estimated: false };
    if (id.includes("haiku")) {
      if (id.includes("3-haiku")) return { inputPer1M: 0.25, outputPer1M: 1.25, estimated: false };
      if (id.includes("haiku-4") || id.includes("4-5-haiku"))
        return { inputPer1M: 1, outputPer1M: 5, estimated: false };
      return { inputPer1M: 0.8, outputPer1M: 4, estimated: false }; // 3.5 Haiku
    }
    return { inputPer1M: 3, outputPer1M: 15, estimated: true };
  }

  // --- Amazon Nova (published) ---
  if (id.includes("nova-micro")) return { inputPer1M: 0.035, outputPer1M: 0.14, estimated: false };
  if (id.includes("nova-lite")) return { inputPer1M: 0.06, outputPer1M: 0.24, estimated: false };
  if (id.includes("nova-pro")) return { inputPer1M: 0.8, outputPer1M: 3.2, estimated: false };
  if (id.includes("nova-premier")) return { inputPer1M: 2.5, outputPer1M: 12.5, estimated: false };
  if (id.includes("nova")) return { inputPer1M: 0.06, outputPer1M: 0.24, estimated: true };

  // --- Rough estimates for the rest ---
  if (id.includes("llama")) return { inputPer1M: 0.4, outputPer1M: 0.6, estimated: true };
  if (id.includes("mistral") || id.includes("ministral") || id.includes("mixtral"))
    return { inputPer1M: 2, outputPer1M: 6, estimated: true };
  if (id.includes("cohere") || id.includes("command"))
    return { inputPer1M: 0.5, outputPer1M: 1.5, estimated: true };
  if (id.includes("titan")) return { inputPer1M: 0.2, outputPer1M: 0.6, estimated: true };

  return { inputPer1M: 0.5, outputPer1M: 1.5, estimated: true };
}

// Prompt-cache pricing multipliers relative to the base input rate: reads are
// heavily discounted, 5-minute writes carry a surcharge. (1-hour writes cost
// more, but we don't use the 1h TTL.)
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

// Cost in USD for a single turn's token usage, including prompt-cache reads and
// writes (which Bedrock bills separately from inputTokens).
export function costFor(
  modelId: string | null,
  inputTokens: number | null,
  outputTokens: number | null,
  cacheReadTokens: number | null = 0,
  cacheWriteTokens: number | null = 0
): number {
  if (!modelId) return 0;
  const rate = priceFor(modelId);
  const inTok = inputTokens ?? 0;
  const outTok = outputTokens ?? 0;
  const readTok = cacheReadTokens ?? 0;
  const writeTok = cacheWriteTokens ?? 0;
  return (
    (inTok * rate.inputPer1M +
      readTok * rate.inputPer1M * CACHE_READ_MULT +
      writeTok * rate.inputPer1M * CACHE_WRITE_MULT +
      outTok * rate.outputPer1M) /
    1_000_000
  );
}
