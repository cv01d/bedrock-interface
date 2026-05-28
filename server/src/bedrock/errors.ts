// Turns terse Bedrock error messages into actionable guidance for the UI.
export function explainBedrockError(raw: string): string {
  const msg = raw || "Request failed.";
  const lower = msg.toLowerCase();

  if (lower.includes("operation not allowed")) {
    return (
      `Bedrock rejected the request: "${msg}". Your AWS account can list models ` +
      `but isn't enabled to invoke them yet. Fixes: (1) In the Bedrock console for ` +
      `this region, open "Model access" and enable the models you want; (2) a brand-new ` +
      `or sandboxed account often must be fully activated (valid payment method / identity ` +
      `verification) before any inference works. This is an account-side setting, not a bug.`
    );
  }
  if (lower.includes("inference profile") || lower.includes("on-demand throughput")) {
    return (
      `${msg} — this model requires a cross-region inference profile. Pick the ` +
      `cross-region variant of the model from the picker (e.g. the "US …" entry).`
    );
  }
  if (lower.includes("accessdenied") || lower.includes("not authorized")) {
    return (
      `${msg} — the IAM user/role is missing a Bedrock permission. Ensure it has ` +
      `bedrock:Converse, bedrock:ConverseStream, and bedrock:InvokeModelWithResponseStream.`
    );
  }
  if (lower.includes("end of its life") || lower.includes("resourcenotfound")) {
    return `${msg} — choose a different (current) model from the picker.`;
  }
  return msg;
}
