import crypto from "crypto";

/**
 * AES-256-GCM encryption for credentials at rest (RDS monitor user
 * passwords, and the per-DB-user passwords used only to render kill
 * commands). Key comes from APP_ENCRYPTION_KEY (base64, 32 bytes).
 *
 * In production, prefer storing APP_ENCRYPTION_KEY in a secrets manager
 * (AWS Secrets Manager / SSM Parameter Store SecureString) rather than a
 * plain environment file, and rotate it periodically (see README).
 */

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and set it in your environment."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "APP_ENCRYPTION_KEY must decode to exactly 32 bytes (256 bits). Generate with `openssl rand -base64 32`."
    );
  }
  return key;
}

const IV_LENGTH = 12; // recommended for GCM
const AUTH_TAG_LENGTH = 16;

/** Encrypts plaintext, returning a single base64 string: iv | ciphertext | authTag. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]).toString("base64");
}

/** Reverses encryptSecret. Throws if the payload was tampered with or the key is wrong. */
export function decryptSecret(payload: string): string {
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
