import crypto from "crypto";

/**
 * Helpers for the three "someone clicks a link we emailed them" flows in
 * this app: account invites, and MFA lost-device recovery.
 *
 * The pattern is always the same and deliberately mirrors how you'd handle
 * a password-reset token: generate a random value, email the RAW value as
 * part of a URL, and store only a SHA-256 hash of it in the database. That
 * way a leaked database (backup, replica, whatever) never hands out a
 * usable token — same reasoning as never storing plaintext passwords.
 */

/** A raw, URL-safe token to email, plus the hash to store in the DB. */
export function generateToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Constant-time-ish compare of two hashes (both fixed-length hex strings). */
export function tokensMatch(hashA: string | null | undefined, hashB: string): boolean {
  if (!hashA) return false;
  const bufA = Buffer.from(hashA, "hex");
  const bufB = Buffer.from(hashB, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
