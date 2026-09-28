import crypto from "crypto";
import bcrypt from "bcryptjs";

/**
 * One-time backup codes, generated whenever MFA setup (or re-setup) is
 * confirmed — the "I have my password but my phone with the authenticator
 * app is gone/broken" escape hatch, distinct from the emailed recovery link
 * (see src/lib/mfa.ts) which instead resets and re-does setup entirely.
 *
 * Shown to the user ONCE, in plaintext, right after they're generated —
 * only bcrypt hashes are ever stored. Each code is single-use: consuming it
 * marks it used rather than deleting it, so a captured code can't be
 * replayed even if the surrounding JSON blob leaks.
 */

const CODE_COUNT = 10;

export interface StoredBackupCode {
  hash: string;
  usedAt: string | null;
}

function randomCode(): string {
  // 8 random uppercase-alnum chars, formatted XXXX-XXXX — easy to read back
  // off a screen, ambiguous-looking characters (0/O, 1/I/L) excluded.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Generates a fresh set of plaintext codes plus their hashed form to store. */
export async function generateBackupCodes(): Promise<{ plaintext: string[]; stored: StoredBackupCode[] }> {
  const plaintext = Array.from({ length: CODE_COUNT }, randomCode);
  const stored: StoredBackupCode[] = await Promise.all(
    plaintext.map(async (code) => ({ hash: await bcrypt.hash(code, 10), usedAt: null }))
  );
  return { plaintext, stored };
}

/**
 * Checks a submitted code against the stored set. On a match, returns the
 * updated set with that code marked used (caller is responsible for saving
 * it) — never returns a match for a code already marked used.
 */
export async function consumeBackupCode(
  storedJson: string | null,
  submitted: string
): Promise<{ ok: boolean; remaining: number; updatedJson: string } | null> {
  if (!storedJson) return null;
  let codes: StoredBackupCode[];
  try {
    codes = JSON.parse(storedJson);
  } catch {
    return null;
  }
  const normalized = submitted.trim().toUpperCase();
  for (let i = 0; i < codes.length; i++) {
    const entry = codes[i];
    if (entry.usedAt) continue;
    if (await bcrypt.compare(normalized, entry.hash)) {
      codes[i] = { ...entry, usedAt: new Date().toISOString() };
      const remaining = codes.filter((c) => !c.usedAt).length;
      return { ok: true, remaining, updatedJson: JSON.stringify(codes) };
    }
  }
  return { ok: false, remaining: codes.filter((c) => !c.usedAt).length, updatedJson: storedJson };
}
