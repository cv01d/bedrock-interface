import { BedrockClient } from "@aws-sdk/client-bedrock";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { getAwsCredentials } from "../db/repo.js";

interface Cached {
  control: BedrockClient;
  runtime: BedrockRuntimeClient;
  fingerprint: string;
}

let cached: Cached | null = null;

export class NoCredentialsError extends Error {
  constructor() {
    super(
      "AWS credentials are not configured. Add them in Settings before chatting."
    );
    this.name = "NoCredentialsError";
  }
}

// Builds (and caches) Bedrock clients from the encrypted creds in Settings.
// Rebuilds automatically when credentials/region change.
function getClients(): Cached {
  const creds = getAwsCredentials();
  if (!creds) throw new NoCredentialsError();

  const fingerprint = `${creds.region}:${creds.accessKeyId}`;
  if (cached && cached.fingerprint === fingerprint) return cached;

  const config = {
    region: creds.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  };
  cached = {
    control: new BedrockClient(config),
    runtime: new BedrockRuntimeClient(config),
    fingerprint,
  };
  return cached;
}

export function getControlClient(): BedrockClient {
  return getClients().control;
}

export function getRuntimeClient(): BedrockRuntimeClient {
  return getClients().runtime;
}

// Force a rebuild on next use (call after settings change).
export function invalidateClients(): void {
  cached = null;
}

// Builds a one-off control client from explicit creds — used to validate
// credentials at save time before we persist/cache them.
export function buildControlClientFrom(creds: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}): BedrockClient {
  return new BedrockClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  });
}
