import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";

/**
 * Thin wrapper around `otpauth` (RFC 6238 TOTP) — the same standard Google
 * Authenticator, Microsoft Authenticator, Authy, and 1Password all speak.
 * Nothing here talks to the phone; the server independently recomputes the
 * expected 6-digit code from the shared secret and the current time, and
 * compares it to what the user typed.
 */

const ISSUER = "Query Monitor";
/** Default 30s step, 6 digits, SHA1 — the universal defaults every
 * authenticator app assumes; deviating breaks compatibility with most of
 * them for no real security benefit. */

function buildTotp(secretBase32: string, accountLabel: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label: accountLabel,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** Generates a brand-new random secret (base32-encoded, as every authenticator app expects). */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/** Renders the secret as a scannable QR code (a PNG data: URL) plus the otpauth:// URI it encodes. */
export async function buildProvisioningQr(
  secretBase32: string,
  accountLabel: string
): Promise<{ otpauthUri: string; qrDataUrl: string }> {
  const totp = buildTotp(secretBase32, accountLabel);
  const otpauthUri = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(otpauthUri, { width: 240, margin: 1 });
  return { otpauthUri, qrDataUrl };
}

/**
 * Checks a 6-digit code against the secret. Allows the current 30s window
 * plus one window on either side (±30s) to tolerate normal clock drift
 * between the phone and this server — the standard tolerance recommended
 * by RFC 6238 implementations.
 */
export function verifyTotpCode(secretBase32: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const totp = buildTotp(secretBase32, "verify"); // label is irrelevant for validation
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}
