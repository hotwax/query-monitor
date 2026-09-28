import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { generateTotpSecret, buildProvisioningQr, verifyTotpCode } from "@/lib/totp";
import { generateBackupCodes, consumeBackupCode } from "@/lib/backup-codes";

/**
 * Shared MFA setup/verify logic, used by both:
 *  - the normal onboarding path (forced /mfa/setup right after a correct
 *    password, for any account that doesn't have MFA enabled yet — new
 *    invited users and any pre-existing account alike), and
 *  - the lost-device email recovery path (/mfa/recovery/[token]), which
 *    re-runs the exact same setup — a fresh secret, a fresh QR code, a
 *    fresh set of backup codes — just authenticated by an emailed token
 *    instead of a session.
 *
 * Deliberately NOT used for a "change my MFA app whenever I feel like it"
 * self-service flow — the only ways to redo setup are onboarding (once) and
 * losing your device (via email or an admin's Reset MFA action), each of
 * which is its own audited event.
 */

const MFA_MAX_ATTEMPTS = 5;
const MFA_LOCKOUT_MINUTES = 5;

/** Starts (or restarts) a setup attempt: generates a new secret, stores it unconfirmed, returns a QR code to scan. */
export async function beginMfaSetup(
  userId: string,
  accountLabel: string
): Promise<{ qrDataUrl: string; secretBase32: string }> {
  const secretBase32 = generateTotpSecret();
  const { qrDataUrl } = await buildProvisioningQr(secretBase32, accountLabel);
  await prisma.user.update({
    where: { id: userId },
    data: { mfaPendingSecretEnc: encryptSecret(secretBase32) },
  });
  // secretBase32 is also returned for manual entry — some phones can't scan.
  return { qrDataUrl, secretBase32 };
}

/** Confirms a setup attempt with the current code from the app. On success, enables MFA and mints backup codes (shown once). */
export async function confirmMfaSetup(
  userId: string,
  code: string
): Promise<{ ok: true; backupCodes: string[] } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.mfaPendingSecretEnc) {
    return { ok: false, error: "No MFA setup in progress — start setup again." };
  }
  const secretBase32 = decryptSecret(user.mfaPendingSecretEnc);
  if (!verifyTotpCode(secretBase32, code)) {
    return { ok: false, error: "That code doesn't match. Check your authenticator app and try again." };
  }

  const { plaintext, stored } = await generateBackupCodes();
  await prisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: true,
      mfaSecretEnc: encryptSecret(secretBase32),
      mfaPendingSecretEnc: null,
      mfaBackupCodesJson: JSON.stringify(stored),
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
    },
  });
  return { ok: true, backupCodes: plaintext };
}

/** Verifies a login-time code (authenticator or backup code) against an already-enabled MFA secret. Rate-limited. */
export async function verifyMfaLogin(
  userId: string,
  input: { code?: string; backupCode?: string }
): Promise<
  | { ok: true; usedBackupCode: boolean; backupCodesRemaining?: number }
  | { ok: false; error: string; lockedUntil?: Date }
> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "Account not found." };

  if (user.mfaLockedUntil && user.mfaLockedUntil > new Date()) {
    return { ok: false, error: "Too many incorrect attempts. Try again in a few minutes.", lockedUntil: user.mfaLockedUntil };
  }

  let matched = false;
  let usedBackupCode = false;
  let backupCodesRemaining: number | undefined;

  if (input.backupCode) {
    const result = await consumeBackupCode(user.mfaBackupCodesJson, input.backupCode);
    if (result?.ok) {
      matched = true;
      usedBackupCode = true;
      backupCodesRemaining = result.remaining;
      await prisma.user.update({ where: { id: userId }, data: { mfaBackupCodesJson: result.updatedJson } });
    }
  } else if (input.code && user.mfaSecretEnc) {
    matched = verifyTotpCode(decryptSecret(user.mfaSecretEnc), input.code);
  }

  if (matched) {
    await prisma.user.update({ where: { id: userId }, data: { mfaFailedAttempts: 0, mfaLockedUntil: null } });
    return { ok: true, usedBackupCode, backupCodesRemaining };
  }

  const attempts = user.mfaFailedAttempts + 1;
  const lockedUntil = attempts >= MFA_MAX_ATTEMPTS ? new Date(Date.now() + MFA_LOCKOUT_MINUTES * 60_000) : null;
  await prisma.user.update({
    where: { id: userId },
    data: { mfaFailedAttempts: lockedUntil ? 0 : attempts, mfaLockedUntil: lockedUntil },
  });
  return lockedUntil
    ? { ok: false, error: `Too many incorrect attempts. Try again in ${MFA_LOCKOUT_MINUTES} minutes.`, lockedUntil }
    : { ok: false, error: "Incorrect code." };
}

/** Wipes MFA entirely, forcing the user through setup again on their next login. Used by admin Reset MFA. */
export async function clearMfa(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: false,
      mfaSecretEnc: null,
      mfaPendingSecretEnc: null,
      mfaBackupCodesJson: null,
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
    },
  });
}
