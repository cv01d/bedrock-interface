import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

// Format of an encrypted BLOB:  version(1) || iv(12) || ciphertext || tag(16)
const VERSION = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let masterKey: Buffer | null = null;
const derivedKeys = new Map<string, Buffer>();

// Call once on boot. Throws if MASTER_KEY is missing or malformed so we never
// silently run with broken encryption.
export function initCrypto(): void {
  const raw = process.env.MASTER_KEY;
  if (!raw) {
    throw new Error(
      "MASTER_KEY is not set. Generate one with `npm run keygen` and add it to .env."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(
      `MASTER_KEY must decode to ${KEY_LEN} bytes (got ${key.length}). ` +
        "Generate a valid one with `npm run keygen`."
    );
  }
  masterKey = key;
}

// Per-domain key separation: a leak of one decrypt path can't be reused to
// read another column type. `domain` is a stable string like "messages.content".
function keyFor(domain: string): Buffer {
  if (!masterKey) {
    throw new Error("Crypto not initialized — call initCrypto() on boot.");
  }
  let k = derivedKeys.get(domain);
  if (!k) {
    const salt = Buffer.from("chat-app-v1", "utf8");
    const info = Buffer.from(domain, "utf8");
    k = Buffer.from(hkdfSync("sha256", masterKey, salt, info, KEY_LEN));
    derivedKeys.set(domain, k);
  }
  return k;
}

export function encrypt(
  plaintext: string,
  domain: string,
  aad: string
): Buffer {
  const key = keyFor(domain);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, ct, tag]);
}

export function decrypt(
  blobIn: Buffer | Uint8Array,
  domain: string,
  aad: string
): string {
  const blob = Buffer.isBuffer(blobIn) ? blobIn : Buffer.from(blobIn);
  if (blob.length < 1 + IV_LEN + TAG_LEN) {
    throw new Error("Encrypted blob is too short to be valid.");
  }
  const version = blob[0];
  if (version !== VERSION) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }
  const iv = blob.subarray(1, 1 + IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ct = blob.subarray(1 + IV_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", keyFor(domain), iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    "utf8"
  );
}

// Convenience for nullable columns.
export function encryptOrNull(
  plaintext: string | null | undefined,
  domain: string,
  aad: string
): Buffer | null {
  if (plaintext == null || plaintext === "") return null;
  return encrypt(plaintext, domain, aad);
}

export function decryptOrEmpty(
  blob: Buffer | Uint8Array | null | undefined,
  domain: string,
  aad: string
): string {
  if (!blob) return "";
  return decrypt(blob, domain, aad);
}
